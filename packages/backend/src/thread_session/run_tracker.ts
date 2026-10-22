import {
  appendAgentRunStepAndUpdateRun,
  appendAgentRunStepAndUpdateRunIfStatus,
  createAgentRun,
  getAgentRun,
  listAgentRunSteps,
  updateAgentRun,
} from '@iki/backend/db/agent_runs';
import { claimQueuedAgentRun } from '@iki/backend/db/agent_runs';
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

  adoptExistingRunId?: string;
};

type FinalizeRunParams = {
  text?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;

  pendingToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
};

type BlockRunParams = FinalizeRunParams & {
  pendingApprovalIds?: string[];
};

type FailRunParams = AgentRunError & Pick<FinalizeRunParams, 'text'>;

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
    ...(Array.isArray(params.pendingToolCalls) && params.pendingToolCalls.length > 0
      ? { pendingToolCalls: params.pendingToolCalls }
      : {}),
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

  const appendStepIfStatus = (
    params: Parameters<typeof appendStep>[0],
    updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>,
    expectedStatuses: readonly AgentRunStatus[]
  ): AgentRunStep | null => {
    if (updates.status) {
      for (const status of expectedStatuses) {
        if (!ALLOWED_STATUS_TRANSITIONS[status].includes(updates.status)) {
          throw new Error(
            'Invalid agent run status transition: ' + status + ' -> ' + updates.status
          );
        }
      }
    }
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

  const failedState = (params: FailRunParams): Pick<AgentRun, 'status' | 'working' | 'error'> => {
    const { text, ...error } = params;
    return {
      status: 'failed',
      working: {
        ...currentRun.working,
        pendingApprovalIds: [],
        ...(typeof text === 'string' ? { accumulatedText: text } : {}),
      },
      error,
    };
  };

  return {
    id: currentRun.id,
    getRun: () => currentRun,
    recordModelStep: record => {
      appendStep({
        type: 'model',
        status: 'completed',
        summary: 'Model inference',
        output: {
          inference: true,
          content: record.content,
          ...(record.finishReason ? { finishReason: record.finishReason } : {}),
          usage: record.usage,
        },
      });
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
      // No step: the run row already carries the final text, finish reason and
      // usage, and the trajectory shows the last model step as the answer. A
      // second record of the same text is what made every turn look like it
      // ended in a separate "finalize" event.
      persist({
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
      }, failedState(params));
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
      }, failedState(params), expectedStatuses);
      return claimed ? currentRun : null;
    },
    markCancelled: params => {
      // Same rule as markCompleted: the row carries the outcome, so no step.
      persist({
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
