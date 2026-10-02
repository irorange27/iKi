import {
  appendAgentRunStepAndUpdateRun,
  appendAgentRunStepAndUpdateRunIfStatus,
  createAgentRun,
  getAgentRun,
  listAgentRunSteps,
  listAgentRunsByStatus,
  updateAgentRun,
} from '@iki/backend/db/agent_runs';
import { claimQueuedAgentRun } from '@iki/backend/db/agent_runs';
import { hasLiveThreadRunLease } from '@iki/backend/db/thread_run_locks';
import { getChatMessages, updateChatMessage } from '@iki/backend/db/chat_message';
import { expirePendingToolCallApprovalsByRunIds } from '@iki/backend/db/tool_call_approval';
import type { DynamicToolPart } from '@iki/backend/message/tool_parts';
import {
  interruptedToolPartErrorText,
  isObjectRecord,
  isTerminalDynamicToolPart,
  toInterruptedToolPart,
} from '@iki/backend/message/tool_parts';
import type {
  AgentRun,
  AgentRunError,
  AgentRunInput,
  AgentRunKind,
  AgentRunOutput,
  AgentRunStatus,
  AgentRunStep,
  AgentRunStepType,
  AgentRunWorkingState,
} from '@iki/backend/types/agent_run';
import type { AgentStep, ModelInferenceRecord } from '@iki/backend/agent/agent_step';
import { createPrefixedId } from '@iki/backend/utils/id';
import {
  normalizeWhitespace,
  sanitizePromptMetadataText,
  toIsoNow,
} from '@iki/backend/utils/text';

type CreateAgentRunTrackerParams = {
  kind: AgentRunKind;
  threadId?: string;
  parentRunId?: string;
  rootRunId?: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
  availableSkillIds: string[];
  input: AgentRunInput;
  working: AgentRunWorkingState;
  /**
   * Adopt an existing (already claimed) run row instead of creating a new id —
   * a queued resume or retry executes IN the queued identity. The row's own
   * fields are authoritative; the descriptive params above are ignored.
   * Claim via `claimQueuedAgentRun` first.
   */
  adoptExistingRunId?: string;
};

type FinalizeRunParams = {
  text?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
};

type BlockRunParams = FinalizeRunParams & {
  pendingApprovalIds?: string[];
};

type FailRunParams = AgentRunError;

const ALLOWED_STATUS_TRANSITIONS: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  queued: ['running', 'failed', 'cancelled'],
  running: ['blocked', 'completed', 'failed', 'cancelled'],
  blocked: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const assertRunStatusTransition = (run: AgentRun, nextStatus: AgentRunStatus): void => {
  if (run.status === nextStatus) return;
  if (ALLOWED_STATUS_TRANSITIONS[run.status].includes(nextStatus)) return;
  throw new Error('Invalid agent run status transition: ' + run.status + ' -> ' + nextStatus);
};

const toSummary = (value: string, fallback: string): string =>
  sanitizePromptMetadataText(value, { maxChars: 160 }) || fallback;

const buildOutput = (params: FinalizeRunParams): AgentRunOutput | null => {
  const output: AgentRunOutput = {
    ...(typeof params.text === 'string' ? { text: params.text } : {}),
    ...(typeof params.finishReason === 'string' ? { finishReason: params.finishReason } : {}),
    ...(params.usage && typeof params.usage === 'object' ? { usage: params.usage } : {}),
  };
  return Object.keys(output).length > 0 ? output : null;
};

const inferRootRunId = (parentRunId?: string, explicitRootRunId?: string): string | null => {
  const normalizedRootRunId = normalizeWhitespace(explicitRootRunId);
  if (normalizedRootRunId) return normalizedRootRunId;

  const normalizedParentRunId = normalizeWhitespace(parentRunId);
  if (!normalizedParentRunId) return null;

  return getAgentRun(normalizedParentRunId)?.rootRunId ?? normalizedParentRunId;
};

export type AgentRunTracker = {
  id: string;
  getRun: () => AgentRun;
  recordModelStep: (record: ModelInferenceRecord) => void;
  syncModelMessages: (messages: unknown[]) => AgentRun;
  recordAgentStep: (step: AgentStep) => void;
  recordApprovalResponse: (params: {
    approvalId: string;
    toolCallId?: string;
    approved: boolean;
    reason?: string;
  }) => AgentRun;
  markResumed: (params: { childRunId: string }) => AgentRun;
  recordChildRun: (params: {
    childRunId: string;
    childKind: AgentRunKind;
    summary?: string;
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
  }) => AgentRun;
  markCompleted: (params: FinalizeRunParams) => AgentRun;
  markBlocked: (params: BlockRunParams) => AgentRun;
  markFailed: (params: FailRunParams) => AgentRun;
  /** Conditional recovery finalize (see appendStepIfStatus). */
  markFailedIfStatus: (
    expectedStatuses: readonly AgentRunStatus[],
    params: FailRunParams
  ) => AgentRun | null;
  markCancelled: (params?: Pick<FinalizeRunParams, 'text'>) => AgentRun;
};

const createAgentRunTrackerForRun = (initialRun: AgentRun): AgentRunTracker => {
  let currentRun = initialRun;
  let recordedApprovalResponseIds: Set<string> | null = null;

  const persist = (updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>) => {
    if (updates.status) assertRunStatusTransition(currentRun, updates.status);
    const updated = updateAgentRun(currentRun.id, updates);
    if (updated) {
      currentRun = updated;
    } else {
      currentRun = {
        ...currentRun,
        ...updates,
        updatedAt: toIsoNow(),
      };
    }
  };

  const appendStep = (params: {
    type: AgentRunStepType;
    status: AgentRunStep['status'];
    summary: string;
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
  }, updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>> = {}): AgentRunStep => {
    if (updates.status) assertRunStatusTransition(currentRun, updates.status);
    const startedAt = toIsoNow();
    const stepIndex = currentRun.working.lastStepIndex + 1;
    const step: AgentRunStep = {
      id: createPrefixedId('step'),
      runId: currentRun.id,
      stepIndex,
      type: params.type,
      status: params.status,
      summary: params.summary,
      input: params.input ?? null,
      output: params.output ?? null,
      startedAt,
      finishedAt: startedAt,
    };
    currentRun = appendAgentRunStepAndUpdateRun(step, {
      ...updates,
      working: {
        ...currentRun.working,
        ...(updates.working ?? {}),
        lastStepIndex: stepIndex,
      },
    });
    return step;
  };

  /**
   * Recovery-only conditional finalize: the step and terminal run update are
   * written only while the run row is still in one of `expectedStatuses`.
   * Returns null (nothing written) when another writer finalized or reclaimed
   * the run first.
   */
  const appendStepIfStatus = (
    params: Parameters<typeof appendStep>[0],
    updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>,
    expectedStatuses: readonly AgentRunStatus[]
  ): AgentRunStep | null => {
    if (updates.status) assertRunStatusTransition(currentRun, updates.status);
    const startedAt = toIsoNow();
    const stepIndex = currentRun.working.lastStepIndex + 1;
    const step: AgentRunStep = {
      id: createPrefixedId('step'),
      runId: currentRun.id,
      stepIndex,
      type: params.type,
      status: params.status,
      summary: params.summary,
      input: params.input ?? null,
      output: params.output ?? null,
      startedAt,
      finishedAt: startedAt,
    };
    const updated = appendAgentRunStepAndUpdateRunIfStatus(
      step,
      {
        ...updates,
        working: {
          ...currentRun.working,
          ...(updates.working ?? {}),
          lastStepIndex: stepIndex,
        },
      },
      expectedStatuses
    );
    if (!updated) return null;
    currentRun = updated;
    return step;
  };

  return {
    id: currentRun.id,
    getRun: () => currentRun,
    recordModelStep: record => {
      appendStep({
        type: 'model',
        status: 'completed',
        summary: 'Model inference',
        input: { messages: record.messages, systemPrompt: record.systemPrompt },
        output: {
          inference: true,
          content: record.content,
          ...(record.finishReason ? { finishReason: record.finishReason } : {}),
          usage: record.usage,
        },
      });
    },
    syncModelMessages: messages => {
      persist({
        working: {
          ...currentRun.working,
          modelMessages: Array.isArray(messages) ? structuredClone(messages) : [],
        },
      });
      return currentRun;
    },
    recordAgentStep: step => {
      if (step.type === 'tool_execution_start') {
        appendStep({
          type: 'tool-call',
          status: 'completed',
          summary: toSummary('Tool call ' + step.toolName, 'Tool call'),
          input: {
            toolCallId: step.toolCallId,
            toolName: step.toolName,
            input: step.input,
          },
        });
        return;
      }

      if (step.type === 'tool_execution_end') {
        if (step.outcome === 'success') {
          appendStep({
            type: 'tool-result',
            status: 'completed',
            summary: 'Tool result',
            input: { toolCallId: step.toolCallId },
            output: { output: step.output ?? null },
          });
        } else {
          appendStep({
            type: 'error',
            status: 'failed',
            summary: toSummary(step.error ?? 'Tool execution failed', 'Tool error'),
            input: { toolCallId: step.toolCallId },
            output: { error: step.error ?? 'Tool execution failed' },
          });
        }
        return;
      }

      if (step.type === 'approval_request') {
        for (const request of step.requests) {
          const approvalId = normalizeWhitespace(request.approvalId) || createPrefixedId('approval');
          const pendingApprovalIds = Array.from(
            new Set([...currentRun.working.pendingApprovalIds, approvalId])
          );
          appendStep({
            type: 'approval-request',
            status: 'completed',
            summary: toSummary(
              'Approval requested for ' + (request.toolCall?.toolName ?? 'tool'),
              'Approval requested'
            ),
            input: {
              approvalId,
              ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
              ...(request.toolCall?.toolName ? { toolName: request.toolCall.toolName } : {}),
            },
          }, {
            status: 'blocked',
            working: {
              ...currentRun.working,
              pendingApprovalIds,
            },
          });
        }
      }
    },
    recordApprovalResponse: params => {
      const approvalId = normalizeWhitespace(params.approvalId);
      if (!approvalId) return currentRun;
      recordedApprovalResponseIds ??= new Set(
        listAgentRunSteps(currentRun.id)
          .filter(step => step.type === 'approval-response')
          .map(step => normalizeWhitespace(step.input?.approvalId))
          .filter(Boolean)
      );
      if (recordedApprovalResponseIds.has(approvalId)) return currentRun;
      appendStep({
        type: 'approval-response',
        status: 'completed',
        summary: 'Tool approval ' + (params.approved ? 'approved' : 'rejected'),
        input: {
          approvalId,
          ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
          approved: params.approved,
          ...(params.reason ? { reason: params.reason } : {}),
        },
      });
      recordedApprovalResponseIds.add(approvalId);
      return currentRun;
    },
    markResumed: params => {
      const childRunId = normalizeWhitespace(params.childRunId);
      if (!childRunId) throw new Error('Resumed Run requires a child Run ID');
      const text = currentRun.output?.text ?? currentRun.working.accumulatedText;
      const usage = currentRun.output?.usage;
      appendStep({
        type: 'finalize',
        status: 'completed',
        summary: 'Approval answered; continuation started',
        input: {
          childRunId,
          answeredApprovalIds: currentRun.working.pendingApprovalIds,
        },
        output: {
          ...(text ? { text } : {}),
          finishReason: 'approval-resumed',
        },
      }, {
        status: 'completed',
        working: {
          ...currentRun.working,
          pendingApprovalIds: [],
        },
        output: buildOutput({
          ...(text ? { text } : {}),
          finishReason: 'approval-resumed',
          ...(usage ? { usage } : {}),
        }),
        error: null,
      });
      return currentRun;
    },
    recordChildRun: params => {
      appendStep({
        type: 'child-run',
        status: 'completed',
        summary: toSummary(
          params.summary || `Spawned ${params.childKind} run ${params.childRunId}`,
          'Child run spawned'
        ),
        input: {
          childRunId: params.childRunId,
          childKind: params.childKind,
          ...(params.input ?? {}),
        },
        output: params.output ?? null,
      });
      return currentRun;
    },
    markCompleted: params => {
      appendStep({
        type: 'model',
        status: 'completed',
        summary: toSummary('Run completed successfully', 'Run completed'),
        output: {
          ...(typeof params.text === 'string' ? { text: params.text } : {}),
          ...(typeof params.finishReason === 'string'
            ? { finishReason: params.finishReason }
            : {}),
          ...(params.usage && typeof params.usage === 'object' ? { usage: params.usage } : {}),
        },
      }, {
        status: 'completed',
        working: {
          ...currentRun.working,
          accumulatedText: typeof params.text === 'string' ? params.text : '',
          pendingApprovalIds: [],
        },
        output: buildOutput({
          ...params,
          finishReason: params.finishReason || 'completed',
        }),
        error: null,
      });
      return currentRun;
    },
    markBlocked: params => {
      const pendingApprovalIds = Array.from(
        new Set([
          ...currentRun.working.pendingApprovalIds,
          ...((params.pendingApprovalIds ?? []).map(id => normalizeWhitespace(id)).filter(Boolean) as string[]),
        ])
      );

      const updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>> = {
        status: 'blocked',
        working: {
          ...currentRun.working,
          accumulatedText: typeof params.text === 'string' ? params.text : '',
          pendingApprovalIds,
        },
        output: buildOutput({
          ...params,
          finishReason: params.finishReason || 'approval-requested',
        }),
        error: null,
      };
      if (pendingApprovalIds.length > 0 && currentRun.working.pendingApprovalIds.length === 0) {
        appendStep({
          type: 'approval-request',
          status: 'completed',
          summary: toSummary('Approval requested', 'Approval requested'),
          output: {
            pendingApprovalIds,
          },
        }, updates);
      } else {
        persist(updates);
      }
      return currentRun;
    },
    markFailed: params => {
      appendStep({
        type: 'error',
        status: 'failed',
        summary: toSummary(params.message, 'Run failed'),
        output: {
          message: params.message,
          ...(typeof params.code === 'string' ? { code: params.code } : {}),
          ...(typeof params.retryable === 'boolean' ? { retryable: params.retryable } : {}),
        },
      }, {
        status: 'failed',
        working: {
          ...currentRun.working,
          pendingApprovalIds: [],
        },
        error: params,
      });
      return currentRun;
    },
    markFailedIfStatus: (expectedStatuses, params) => {
      const claimed = appendStepIfStatus({
        type: 'error',
        status: 'failed',
        summary: toSummary(params.message, 'Run failed'),
        output: {
          message: params.message,
          ...(typeof params.code === 'string' ? { code: params.code } : {}),
          ...(typeof params.retryable === 'boolean' ? { retryable: params.retryable } : {}),
        },
      }, {
        status: 'failed',
        working: {
          ...currentRun.working,
          pendingApprovalIds: [],
        },
        error: params,
      }, expectedStatuses);
      return claimed ? currentRun : null;
    },
    markCancelled: params => {
      appendStep({
        type: 'finalize',
        status: 'completed',
        summary: toSummary('Run cancelled', 'Run cancelled'),
        output: typeof params?.text === 'string' ? { text: params.text } : null,
      }, {
        status: 'cancelled',
        working: {
          ...currentRun.working,
          accumulatedText: typeof params?.text === 'string' ? params.text : '',
          pendingApprovalIds: [],
        },
        output: buildOutput({
          text: params?.text,
          finishReason: 'cancelled',
        }),
      });
      return currentRun;
    },
  };
};

export const createAgentRunTracker = (
  params: CreateAgentRunTrackerParams
): AgentRunTracker => {
  if (params.adoptExistingRunId) {
    const adopted = claimQueuedAgentRun(params.adoptExistingRunId);
    if (!adopted) {
      throw new Error(
        'Queued run "' + params.adoptExistingRunId + '" was already claimed or is not claimable.'
      );
    }
    return createAgentRunTrackerForRun(adopted);
  }
  const runId = createPrefixedId('run');
  const normalizedParentRunId = normalizeWhitespace(params.parentRunId) || null;
  const resolvedRootRunId =
    inferRootRunId(normalizedParentRunId ?? undefined, params.rootRunId) || runId;

  const run = createAgentRun({
    id: runId,
    kind: params.kind,
    status: 'running',
    threadId: normalizeWhitespace(params.threadId) || null,
    parentRunId: normalizedParentRunId,
    rootRunId: resolvedRootRunId,
    providerType: params.providerType,
    providerId: normalizeWhitespace(params.providerId) || null,
    model: params.model,
    systemPrompt: params.systemPrompt,
    enabledTools: params.enabledTools,
    availableSkillIds: params.availableSkillIds,
    input: params.input,
    working: params.working,
    output: null,
    error: null,
  });
  return createAgentRunTrackerForRun(run);
};

export const rehydrateAgentRunTracker = (runId: string): AgentRunTracker | null => {
  const run = getAgentRun(normalizeWhitespace(runId));
  return run ? createAgentRunTrackerForRun(run) : null;
};

export type RunRecoveryResult = {
  failedRuns: number;
  blockedRuns: number;
  totalRuns: number;
  expiredApprovals: number;
  interruptedToolParts: number;
  /** Stuck runs left untouched because their thread lease is still alive. */
  skippedLiveLease: number;
};

export const recoverStuckRunsOnStartup = (): RunRecoveryResult => {
  const stuckStatuses: AgentRunStatus[] = ['running', 'blocked'];
  const runs = listAgentRunsByStatus(stuckStatuses);
  let failedRuns = 0;
  let blockedRuns = 0;
  let skippedLiveLease = 0;

  // Recovery may only take over executions whose run right is gone. A stuck
  // row whose thread lease is unexpired can belong to another live process
  // sharing this database — reclaiming it (or its approvals/UI rows) would
  // corrupt a run that is still executing.
  const reclaimable = runs.filter(run => {
    if (run.threadId && hasLiveThreadRunLease(run.threadId)) {
      skippedLiveLease += 1;
      return false;
    }
    return true;
  });

  const runIds = reclaimable.map(run => run.id);
  const expiredApprovals =
    runIds.length > 0 ? expirePendingToolCallApprovalsByRunIds(runIds).length : 0;
  const threadIds = Array.from(
    new Set(reclaimable.map(run => run.threadId).filter((id): id is string => typeof id === 'string'))
  );
  let interruptedToolParts = 0;
  for (const threadId of threadIds) {
    for (const messageRow of getChatMessages(threadId)) {
      if (!messageRow.message.includes('"dynamic-tool"')) continue;
      let parsed: { parts?: unknown[] } | null = null;
      try {
        parsed = JSON.parse(messageRow.message);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed?.parts)) continue;

      let changed = false;
      const parts = parsed.parts.map(part => {
        if (!isObjectRecord(part) || part.type !== 'dynamic-tool') return part;
        if (isTerminalDynamicToolPart(part)) return part;
        changed = true;
        interruptedToolParts += 1;
        return toInterruptedToolPart(
          part as unknown as DynamicToolPart,
          interruptedToolPartErrorText(part as unknown as DynamicToolPart)
        );
      });
      if (changed) {
        updateChatMessage(messageRow.id, {
          message: JSON.stringify({ ...parsed, parts }),
        });
      }
    }
  }

  // Reconcile approval and UI records before making the Run terminal. If any
  // reconciliation fails, the next startup still finds the Run as stuck and
  // can retry the remaining work. The terminal write is conditional: a run
  // that reached a terminal state in between is left as-is.
  for (const run of reclaimable) {
    const tracker = rehydrateAgentRunTracker(run.id);
    if (!tracker) continue;
    const params =
      run.status === 'running'
        ? ({
            message: 'Run interrupted by process restart',
            code: 'PROCESS_RESTART',
            retryable: true,
          } as const)
        : ({
            message: 'Run blocked at restart — approval session lost',
            code: 'APPROVAL_SESSION_LOST',
            retryable: true,
          } as const);
    const claimed = tracker.markFailedIfStatus(stuckStatuses, params);
    if (!claimed) continue;
    if (run.status === 'running') {
      failedRuns += 1;
    } else {
      blockedRuns += 1;
    }
  }

  return {
    failedRuns,
    blockedRuns,
    totalRuns: reclaimable.length,
    expiredApprovals,
    interruptedToolParts,
    skippedLiveLease,
  };
};
