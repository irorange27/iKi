import { createLogger } from '@iki/backend/logger';
import type { ModelMessage, ToolApprovalResponse } from '@iki/backend/message/model_history';

import { cloneModelMessages, type TurnDriverHarness } from '../agent/harness';
import { resumeHistoryFromReplay } from './run_rehydrator';
import { PiToolTurnHarness } from '../agent/runners/pi_tool_turn_harness';
import {
  pausedPlanRunsOnPiToolSupply,
  piDomainResumeHistory,
  PiSupplyRefusedError,
} from './turn_supply_selection';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import { createPrefixedId } from '../utils/id';
import type { ToolCallApprovalDecision } from '@iki/backend/types/tool_call_approval';
import { getErrorMessage } from '@iki/backend/utils/errors';
import type { ApprovalRecoveryContext } from './approval_types';
import { reidentifyPlan } from './approval_types';
import type { ExecutionPlan } from './execution_plan';
import { planToHarnessConfig, planToRunTrackerParams } from './execution_plan';
import { parseExecutionPlan, serializeExecutionPlan } from './execution_plan_codec';
import {
  recordFailureTerminalEvent,
  recordSessionEvents,
  rebuildThreadViewFromEvents,
  turnFactsToEvents,
  APPROVAL_REQUESTED,
  APPROVAL_DECIDED,
  SESSION_EVENT_VERSION,
  type ApprovalDecidedPayload,
} from './session_log';
import {
  createTurnDriver,
  finalizeTurn,
  finalizeTurnCancelled,
  finalizeTurnFailure,
  runFailureFromError,
} from './turn_driver';
import { parseStoredWorkspaceSelection } from '../workspaces/thread_workspace';
import { deriveRunTurnPlan } from './run_rehydrator';
import { executeApprovedTool, prepareToolExecution } from './tool_execution';
export { executeApprovedTool, prepareToolExecution } from './tool_execution';
import { loadPersistedAssistantParts, persistAssistantTurnMessage } from './turn_persistence';
import { createAgentRunTracker, rehydrateAgentRunTracker } from './run_tracker';
import type { ActiveStreamState, ChatStreamTarget } from './types';
import { createUiChunkEmitter } from './ui_stream';

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

const parseStoredPlan = parseExecutionPlan;

type PendingApprovalSession = {
  sessionId?: string;
  target: ChatStreamTarget;
  recoveryContext?: ApprovalRecoveryContext;
  history?: ModelMessage[];
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};

const parseStringArray = (value: string | null | undefined): string[] => {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
    );
  } catch {
    return [];
  }
};

export const createChatApproval = (deps: {

  streams: {
    tryAcquireThreadRun: (
      threadId?: string,
      options?: { onExecutionAbort?: () => void }
    ) => (() => void) | null;
    peek: (senderId: number) => ActiveStreamState | undefined;
    attach: (senderId: number, streamState: ActiveStreamState) => void;
    detach: (senderId: number, streamState: ActiveStreamState) => void;

    registerExecution?: (execution: {
      cancel: (reason: string) => void;
      runId?: string | null;
    }) => { setRunId: (runId: string | null) => void; dispose: () => void };
    registerChildRunAlias: (parentRunId: string, childRunId: string) => () => void;
  };
  conversation: {
    upsertTurnMessage: (input: unknown) => unknown;
  };
  usage: {
    recordUsageEvent: (params: {
      threadId?: string;
      messageId?: string;
      providerType: string;
      model: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
        estimatedCostUsd?: number;
      };
      source?: string;
      metadata?: Record<string, unknown>;
    }) => void;
  };
}) => {
  const pendingApprovalSessions = new Map<string, PendingApprovalSession>();

  const clearApprovalTimeouts = (session: PendingApprovalSession) => {
    if (!session.timeouts) return;
    for (const timeoutId of session.timeouts.values()) {
      clearTimeout(timeoutId);
    }
    session.timeouts.clear();
  };

  const scheduleApprovalTimeout = (
    approvalId: string,
    session: PendingApprovalSession,
    delay = APPROVAL_TIMEOUT_MS
  ) => {
    if (!session.timeouts || session.timeouts.has(approvalId)) return;
    const timeoutId = setTimeout(() => {
      if (session.collectedApprovalResponses.has(approvalId)) return;
      session.timeouts.delete(approvalId);
      void approveTool(
        session.target,
        approvalId,
        false,
        'Approval timed out after 30 minutes',
        'timeout'
      )
        .then(result => {
          if (!result.success && pendingApprovalSessions.get(approvalId) === session) {
            scheduleApprovalTimeout(approvalId, session, 1000);
          }
        })
        .catch(error =>
          createLogger({ module: 'chat_approval' }).event({
            level: 'error',
            event: 'approval.timeout.failed',
            error,
          })
        );
    }, delay);
    session.timeouts.set(approvalId, timeoutId);
  };

  const ensurePendingApprovalSession = (
    approvalId: string,
    session: {
      target: ChatStreamTarget;
      history?: ModelMessage[];
      recoveryContext?: ApprovalRecoveryContext;
    }
  ) => {
    const existing = pendingApprovalSessions.get(approvalId);
    if (existing) {
      existing.target = session.target;
      existing.history = session.history ?? existing.history;
      existing.recoveryContext = session.recoveryContext ?? existing.recoveryContext;
      if (session.recoveryContext?.sessionId) {
        existing.sessionId = session.recoveryContext.sessionId;
      }
      existing.pendingApprovalIds.add(approvalId);
      scheduleApprovalTimeout(approvalId, existing);
      return existing;
    }

    const created: PendingApprovalSession = {
      sessionId: session.recoveryContext?.sessionId,
      target: session.target,
      history: session.history,
      recoveryContext: session.recoveryContext,
      pendingApprovalIds: new Set([approvalId]),
      collectedApprovalResponses: new Map(),
      timeouts: new Map(),
    };
    pendingApprovalSessions.set(approvalId, created);
    scheduleApprovalTimeout(approvalId, created);
    return created;
  };

  const registerApprovalBatch = (
    approvalRequests: Array<{
      approvalId: string;
      toolCallId?: string;
      toolCall?: { toolName: string; args: Record<string, unknown> };
    }>,
    session: {
      target: ChatStreamTarget;
      history?: ModelMessage[];
      recoveryContext?: ApprovalRecoveryContext;
    }
  ) => {
    const approvalIds = approvalRequests
      .map(request => request.approvalId)
      .filter(id => typeof id === 'string' && id.length > 0);

    if (approvalIds.length === 0) return;

    if (session.recoveryContext) {
      const recoveryContext = session.recoveryContext;

      const plan = recoveryContext.plan;

      if (plan.threadId) {
        recordSessionEvents(
          plan.threadId,
          approvalRequests.map(request => ({
            type: APPROVAL_REQUESTED,
            version: SESSION_EVENT_VERSION,
            payload: {
              approvalId: request.approvalId,
              sessionId: recoveryContext.sessionId,
              ...(recoveryContext.runId ? { runId: recoveryContext.runId } : {}),
              ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
              ...(request.toolCall?.toolName ? { toolName: request.toolCall.toolName } : {}),
              ...(request.toolCall?.args ? { args: request.toolCall.args } : {}),
            },
          }))
        );
      }

      toolCallApprovalDb.upsertToolCallApprovalSession({
        session_id: recoveryContext.sessionId,
        thread_id: plan.threadId ?? null,
        assistant_message_id: recoveryContext.assistantMessageId,
        run_id: recoveryContext.runId ?? null,
        provider_type: plan.providerType,
        provider_id: plan.providerId ?? null,
        model: plan.model,
        system_prompt: plan.systemPrompt,
        max_input_tokens: plan.maxInputTokens ?? null,
        max_output_tokens: plan.maxOutputTokens ?? null,
        max_iterations: plan.budget.step ?? null,
        enabled_tools: JSON.stringify(plan.enabledTools),
        available_skill_ids: JSON.stringify(plan.availableSkillIds),

        workspace_selection:
          plan.workspaceSelection !== undefined ? JSON.stringify(plan.workspaceSelection) : null,

        plan_json: serializeExecutionPlan(plan),
      });

      toolCallApprovalDb.upsertToolCallApprovals(
        approvalRequests.map(request => ({
          approval_id: request.approvalId,
          session_id: recoveryContext.sessionId,
          tool_call_id: request.toolCallId || null,
          tool_name: request.toolCall?.toolName || null,
          tool_args: request.toolCall ? JSON.stringify(request.toolCall.args ?? {}) : null,
          state: 'pending',
        }))
      );
    }

    let existingSession: PendingApprovalSession | undefined;
    for (const approvalId of approvalIds) {
      const candidate = pendingApprovalSessions.get(approvalId);
      if (candidate) {
        existingSession = candidate;
        break;
      }
    }

    if (existingSession) {
      existingSession.target = session.target;
      existingSession.history = session.history ?? existingSession.history;
      existingSession.recoveryContext = session.recoveryContext ?? existingSession.recoveryContext;
      if (session.recoveryContext?.sessionId) {
        existingSession.sessionId = session.recoveryContext.sessionId;
      }
      for (const approvalId of approvalIds) {
        existingSession.pendingApprovalIds.add(approvalId);
        pendingApprovalSessions.set(approvalId, existingSession);
        scheduleApprovalTimeout(approvalId, existingSession);
      }
      return;
    }

    const pendingSession: PendingApprovalSession = {
      sessionId: session.recoveryContext?.sessionId,
      target: session.target,
      history: session.history,
      recoveryContext: session.recoveryContext,
      pendingApprovalIds: new Set(approvalIds),
      collectedApprovalResponses: new Map(),
      timeouts: new Map(),
    };

    for (const approvalId of approvalIds) {
      pendingApprovalSessions.set(approvalId, pendingSession);
      scheduleApprovalTimeout(approvalId, pendingSession);
    }
  };

  const tryRecoverApprovalSession = async (
    approvalId: string,
    target: ChatStreamTarget
  ): Promise<PendingApprovalSession | null> => {
    if (!approvalId || typeof approvalId !== 'string') return null;
    const needle = approvalId.trim();
    if (!needle) return null;

    const approvalRecord = toolCallApprovalDb.getToolCallApproval(needle);
    if (!approvalRecord || approvalRecord.state === 'consumed') {
      return null;
    }

    const approvalSession = toolCallApprovalDb.getToolCallApprovalSession(
      approvalRecord.session_id
    );
    if (!approvalSession) return null;

    const activeApprovals = toolCallApprovalDb.getActiveToolCallApprovalsBySession(
      approvalSession.session_id
    );
    if (activeApprovals.length === 0) {
      return null;
    }

    const fallbackToolNames = Array.from(
      new Set(
        activeApprovals
          .map(record => (typeof record.tool_name === 'string' ? record.tool_name.trim() : ''))
          .filter(Boolean)
      )
    );
    const storedRunId =
      typeof approvalSession.run_id === 'string' ? approvalSession.run_id.trim() : '';
    const activeApprovalIds = activeApprovals.map(record => record.approval_id);

    const threadId = approvalSession.thread_id ?? null;
    if (!threadId) return null;

    const replay = rebuildThreadViewFromEvents(threadId);
    const replayApprovalIds = new Set(replay.approvals.map(approval => approval.approvalId));
    const unrecordedApprovals = activeApprovalIds.filter(id => !replayApprovalIds.has(id));

    const replayHistory = await resumeHistoryFromReplay(replay);

    const replayWithSystem = replayHistory
      ? [
          ...replay.inputSystemPrompts.map(
            content => ({ role: 'system', content }) as ModelMessage
          ),
          ...replayHistory,
        ]
      : null;
    const inputMessages =
      unrecordedApprovals.length === 0 && replayWithSystem ? replayWithSystem : null;
    if (!inputMessages || inputMessages.length === 0) {
      createLogger({ module: 'chat_approval' }).event({
        level: 'warn',
        event: 'chat.approval.resume_history',
        outcome: 'denied',
        entity: { thread_id: threadId },
        message:
          'Approval resume refused: the session log has no history or misses the pending approvals.',
        data: {
          run_id: storedRunId || null,
          unrecorded_approval_ids: unrecordedApprovals,
        },
      });
      return null;
    }

    const replayPlan = storedRunId
      ? replay.turns.find(turn => turn.runId === storedRunId)?.plan
      : undefined;
    const parsedPlan = replayPlan ?? parseStoredPlan(approvalSession.plan_json);
    const runSnapshot = !parsedPlan && storedRunId ? agentRunDb.getAgentRun(storedRunId) : null;
    const derivedPlan = deriveRunTurnPlan(runSnapshot, {
      providerType: approvalSession.provider_type,
      providerId: approvalSession.provider_id,
      model: approvalSession.model,
      systemPrompt: approvalSession.system_prompt,
      enabledTools: parseStringArray(approvalSession.enabled_tools),
      availableSkillIds: parseStringArray(approvalSession.available_skill_ids),
      maxIterations: approvalSession.max_iterations ?? undefined,
    });
    const resolvedToolNames =
      derivedPlan.enabledTools.length > 0
        ? derivedPlan.enabledTools
        : Array.from(
            new Set(
              [...fallbackToolNames, ...activeApprovals.map(record => record.tool_name ?? '')]
                .map(toolName => (typeof toolName === 'string' ? toolName.trim() : ''))
                .filter(Boolean)
            )
          );

    const pendingApprovalIds = new Set(activeApprovals.map(record => record.approval_id));
    const collectedApprovalResponses = new Map<string, ToolApprovalResponse>();
    for (const record of activeApprovals) {
      if (record.state !== 'answered' || !record.decision) continue;
      collectedApprovalResponses.set(record.approval_id, {
        type: 'tool-approval-response',
        approvalId: record.approval_id,
        approved: record.decision === 'approved',
        reason:
          typeof record.decision_reason === 'string' && record.decision_reason.trim()
            ? record.decision_reason
            : record.decision === 'approved'
              ? 'User approved tool execution.'
              : 'User rejected tool execution.',
      });
    }

    const plan: ExecutionPlan = parsedPlan ?? {
      providerType: derivedPlan.providerType,
      ...(derivedPlan.providerId ? { providerId: derivedPlan.providerId } : {}),
      model: derivedPlan.model,

      enableTools: true,
      enabledTools: resolvedToolNames,
      availableSkillIds: derivedPlan.availableSkillIds,
      requireApproval: derivedPlan.requireApproval ?? true,
      autoApproveToolRequests: false,
      ...(derivedPlan.approvalPolicy ? { approvalPolicy: derivedPlan.approvalPolicy } : {}),

      budget: {
        step: derivedPlan.maxIterations,
        ...(derivedPlan.autonomous
          ? {
              batch: {
                max: derivedPlan.autonomous.maxIterations,
                ...(derivedPlan.autonomous.continuePrompt
                  ? { continuePrompt: derivedPlan.autonomous.continuePrompt }
                  : {}),
              },
            }
          : {}),
      },

      ...(derivedPlan.reasoningEffort ? { reasoningEffort: derivedPlan.reasoningEffort } : {}),
      ...(typeof approvalSession.max_input_tokens === 'number'
        ? { maxInputTokens: approvalSession.max_input_tokens }
        : {}),
      ...(typeof approvalSession.max_output_tokens === 'number'
        ? { maxOutputTokens: approvalSession.max_output_tokens }
        : {}),
      systemPrompt: derivedPlan.systemPrompt,
      skillMode: 'manual',
      threadId,
      kind: 'chat-turn',
      runMetadata: {},
      transport: 'approval-resume',
      workspaceSelection: parseStoredWorkspaceSelection(approvalSession.workspace_selection),
    };

    const session: PendingApprovalSession = {
      sessionId: approvalSession.session_id,
      target,
      history: inputMessages,
      recoveryContext: {
        plan,
        sessionId: approvalSession.session_id,
        assistantMessageId: approvalSession.assistant_message_id,
        ...(storedRunId ? { runId: storedRunId } : {}),
      },
      pendingApprovalIds,
      collectedApprovalResponses,
      timeouts: new Map(),
    };

    for (const id of pendingApprovalIds) {
      pendingApprovalSessions.set(id, session);
      scheduleApprovalTimeout(id, session);
    }

    return session;
  };

  const resumeApproval = async (
    target: ChatStreamTarget,
    approvalId: string,
    approved: boolean,
    reason?: string,
    executionAbort?: { current: (() => void) | null; lost: boolean },
    source: ApprovalDecidedPayload['source'] = 'user'
  ) => {
    const storedApproval = toolCallApprovalDb.getToolCallApproval(approvalId);
    let session = pendingApprovalSessions.get(approvalId);
    if (!session) {
      session = await tryRecoverApprovalSession(approvalId, target);
    }
    if (!session) {
      if (storedApproval && storedApproval.state !== 'pending') {
        return {
          success: false,
          error: 'Approval request already processed.',
        };
      }
      return {
        success: false,
        error: 'Approval request not found or already processed.',
      };
    }

    session.target = target;

    const approvalResponse: ToolApprovalResponse = {
      type: 'tool-approval-response',
      approvalId,
      approved,
      reason:
        reason ?? (approved ? 'User approved tool execution.' : 'User rejected tool execution.'),
    };

    const recordApprovalResponse = () => {
      const runId = session?.recoveryContext?.runId;
      if (!runId) return;
      rehydrateAgentRunTracker(runId)?.recordApprovalResponse({
        approvalId,
        ...(storedApproval?.tool_call_id ? { toolCallId: storedApproval.tool_call_id } : {}),
        approved,
        reason: approvalResponse.reason,
      });
    };

    const decidedThreadId =
      session.recoveryContext?.plan.threadId ??
      (() => {
        const stored = toolCallApprovalDb.getToolCallApprovalSession(
          toolCallApprovalDb.getToolCallApproval(approvalId)?.session_id ?? ''
        );
        return stored?.thread_id ?? null;
      })();
    const recordDecisionEvent = () => {
      if (!decidedThreadId) return;
      recordSessionEvents(decidedThreadId, [
        {
          type: APPROVAL_DECIDED,
          version: SESSION_EVENT_VERSION,
          payload: {
            approvalId,
            approved,
            ...(approvalResponse.reason ? { reason: approvalResponse.reason } : {}),
            source,
          },
        },
      ]);
    };

    if (session.collectedApprovalResponses.has(approvalId)) {
      const existing = session.collectedApprovalResponses.get(approvalId);

      if (existing && existing.approved === approved) {
        recordApprovalResponse();
        return { success: true };
      }
      return {
        success: false,
        error: 'Approval request already processed.',
      };
    }

    recordDecisionEvent();
    session.collectedApprovalResponses.set(approvalId, approvalResponse);
    const decision: ToolCallApprovalDecision = approved ? 'approved' : 'rejected';
    toolCallApprovalDb.answerToolCallApproval(approvalId, decision, approvalResponse.reason);
    recordApprovalResponse();

    const waitingForApprovals = Array.from(session.pendingApprovalIds).filter(
      id => !session.collectedApprovalResponses.has(id)
    );

    if (waitingForApprovals.length > 0) {
      return {
        success: true,
        awaitingApproval: true,
        waitingForApprovals,
      };
    }

    const piResumeAdmission = (() => {
      const pausedPlan = session.recoveryContext?.plan;
      const pausedHistory = cloneModelMessages(session.history ?? []);
      if (!pausedPlan?.threadId || !pausedPlanRunsOnPiToolSupply(pausedPlan, pausedHistory)) {
        return undefined;
      }

      try {
        const commands = Array.from(session.pendingApprovalIds).flatMap((approvalId: string) => {
          const row = toolCallApprovalDb.getToolCallApproval(approvalId);

          if (!row?.tool_call_id || !row.tool_name) {
            throw new Error(`Approval row ${approvalId} is missing its execution binding.`);
          }
          return [
            {
              approvalId,
              toolCallId: row.tool_call_id,
              toolName: row.tool_name,
              args: JSON.parse(row.tool_args ?? '{}') as Record<string, unknown>,
            },
          ];
        });
        for (const command of commands) {
          prepareToolExecution({ threadId: pausedPlan.threadId, approvalId: command.approvalId });
        }
        return { commands, threadId: pausedPlan.threadId };
      } catch (error) {
        session.collectedApprovalResponses.delete(approvalId);
        throw error;
      }
    })();

    const resumeMessageId = session.recoveryContext?.sessionId ?? createPrefixedId('assistant');
    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    if (executionAbort) {

      executionAbort.current = () => {
        streamState.cancelled = true;
        streamState.abortController.abort('thread-lease-lost');
      };
      if (executionAbort.lost) executionAbort.current();
    }
    const uiChunkEmitter = createUiChunkEmitter(session.target, resumeMessageId);
    const baseApprovalContext = session.recoveryContext
      ? {
          ...session.recoveryContext,
          sessionId: resumeMessageId,
          assistantMessageId: resumeMessageId,
        }
      : undefined;
    const resumePlan = baseApprovalContext
      ? reidentifyPlan(baseApprovalContext.plan, {
          kind: 'approval-resume',
          parentRunId: baseApprovalContext.runId,
          transport: 'approval-resume',
        })
      : undefined;
    const resumeRunTracker = resumePlan
      ? createAgentRunTracker(
          planToRunTrackerParams(resumePlan, {
            input: {
              messages: session.history ?? [],
            },
            working: {
              accumulatedText: '',
              pendingApprovalIds: Array.from(session.pendingApprovalIds).filter(
                id => !session.collectedApprovalResponses.has(id)
              ),
              lastStepIndex: 0,
            },
            metadataExtras: {
              sourceSessionId: session.sessionId ?? session.recoveryContext?.sessionId ?? null,
              sourceRunId: session.recoveryContext?.runId ?? null,
              answeredApprovalIds: Array.from(session.collectedApprovalResponses.keys()),
              assistantMessageId: uiChunkEmitter.messageId,
            },
          })
        )
      : null;
    if (resumePlan?.threadId && resumeRunTracker) {

      const parentStatus = baseApprovalContext?.runId
        ? rehydrateAgentRunTracker(baseApprovalContext.runId)?.getRun().status
        : undefined;
      const parentStillResumable =
        parentStatus === 'running' || parentStatus === 'blocked' || parentStatus === 'queued';

      try {
        recordSessionEvents(
          resumePlan.threadId,
          turnFactsToEvents({
            ...(baseApprovalContext?.runId && parentStillResumable
              ? {
                  terminal: {
                    runId: baseApprovalContext.runId,
                    status: 'completed' as const,
                    finishReason: 'approval-resumed',
                  },
                }
              : {}),
            started: { runId: resumeRunTracker.id, kind: resumePlan.kind, plan: resumePlan },
          })
        );
      } catch (error) {
        session.collectedApprovalResponses.delete(approvalId);

        finalizeTurnFailure({
          tracker: resumeRunTracker,
          failure: {
            status: 'failed',
            errorText: getErrorMessage(error),
            retryable: true,
          },
          threadId: resumePlan.threadId,
          transport: 'approval-resume',
          loudGuard: true,
        });
        throw error;
      }
    }

    clearApprovalTimeouts(session);
    for (const pendingId of session.pendingApprovalIds) {
      pendingApprovalSessions.delete(pendingId);
    }
    if (session.sessionId) {
      toolCallApprovalDb.consumeToolCallApprovalSession(session.sessionId);
    }

    const resumedSenderId = session.target.id;
    const existingStream = deps.streams.peek(resumedSenderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('resume-after-tool-approval');
    }

    if (resumeRunTracker && baseApprovalContext?.runId) {
      rehydrateAgentRunTracker(baseApprovalContext.runId)?.markResumed({
        childRunId: resumeRunTracker.id,
      });
    }
    const nextApprovalContext = baseApprovalContext
      ? {
          ...baseApprovalContext,
          ...(resumePlan ? { plan: resumePlan } : {}),
          ...(resumeRunTracker ? { runId: resumeRunTracker.id } : {}),
        }
      : undefined;
    streamState.runId = resumeRunTracker?.id;
    deps.streams.attach(resumedSenderId, streamState);

    const execution = deps.streams.registerExecution?.({
      runId: resumeRunTracker?.id ?? null,
      cancel: reason => {
        streamState.cancelled = true;
        streamState.abortController.abort(reason);
      },
    });
    let isAwaitingApproval = false;

    let driverHandle: ReturnType<typeof createTurnDriver> | null = null;

    try {
      const ctx = nextApprovalContext ?? session.recoveryContext;
      if (!ctx || !resumeRunTracker) {
        throw new Error("Approval resume requires the paused turn's recovery context");
      }

      const resumesOnPi = Boolean(piResumeAdmission);

      if (!piResumeAdmission) {
        throw new PiSupplyRefusedError(
          'the paused turn no longer matches an admissible provider plan (its provider row may have been removed or disabled)',
          'config',
          {
            providerType: ctx.plan.providerType,
            providerId: ctx.plan.providerId ?? null,
            model: ctx.plan.model,
          }
        );
      }
      const approvalHarness: TurnDriverHarness = new PiToolTurnHarness(
        planToHarnessConfig(ctx.plan),
        {
          resume: {
            commands: piResumeAdmission.commands,
            owner: {
              prepare: address => prepareToolExecution(address),
              executeApproved: (address, port) =>
                executeApprovedTool(address, {
                  signal: port.signal ?? new AbortController().signal,
                  execute: async (toolName, args) =>
                    (await port.execute(toolName, args)) as unknown,
                }),
            },
          },
        }
      );

      const streamHistory = piDomainResumeHistory(cloneModelMessages(session.history ?? []));

      const persistResumeProgress = () => {
        const threadId = baseApprovalContext?.plan.threadId;
        if (!threadId) return;
        void uiChunkEmitter
          .buildPersistedMessage(loadPersistedAssistantParts(uiChunkEmitter.messageId))
          .then(persisted =>
            persisted
              ? persistAssistantTurnMessage(
                  deps.conversation,
                  threadId,
                  persisted,
                  'stream-progress'
                )
              : undefined
          );
      };

      const driver = createTurnDriver(
        {
          harness: approvalHarness,
          runTracker: resumeRunTracker,
          approvalContext: nextApprovalContext,
          streamHistory,
          streamPrompt: '',
          ...(ctx.plan.workspaceSelection !== undefined
            ? { workspaceSelectionBox: { selection: ctx.plan.workspaceSelection } }
            : {}),
        },
        {
          target: session.target,
          plan: ctx.plan,
          streamState,
          uiChunkEmitter,
          notifyRunStatus: () => undefined,
          drainSteerMessages: () => [],
          conversationPreview: false,
          onToolActivity: persistResumeProgress,

          onRunIdChanged: runId => execution?.setRunId(runId),
          registerChildRunAlias: deps.streams.registerChildRunAlias,
          approvals: {
            ensurePendingApprovalSession: (approvalId, approvalSession) =>
              ensurePendingApprovalSession(approvalId, approvalSession),
            registerApprovalBatch: (requests, approvalSession) =>
              registerApprovalBatch(requests, approvalSession),
          },
        }
      );

      driverHandle = driver;
      const driverResult = await driver.run();
      if (!driverResult) {
        throw new Error('Unreachable: approval resume produced no result');
      }
      const streamResult = driverResult;

      isAwaitingApproval = streamResult.outcome === 'awaiting-approval';
      if (streamResult.outcome === 'cancelled') {
        uiChunkEmitter.abort();
      } else if (!isAwaitingApproval) {
        uiChunkEmitter.finish();
      }

      const finalTracker = driver.getRunTracker();
      if (streamResult.outcome !== 'cancelled' && nextApprovalContext) {
        deps.usage.recordUsageEvent({
          threadId: nextApprovalContext.plan.threadId,
          messageId: uiChunkEmitter.messageId,
          providerType: nextApprovalContext.plan.providerType,
          model: nextApprovalContext.plan.model,
          usage: streamResult.usage,
          source: 'chat.approval-stream',
          metadata: {
            sessionId: nextApprovalContext.sessionId,
            awaitingApproval: isAwaitingApproval,
          },
        });
      }

      let persistedContinuation:
        | Awaited<ReturnType<typeof uiChunkEmitter.buildPersistedMessage>>
        | undefined;
      if (baseApprovalContext?.plan.threadId) {

        persistedContinuation = await uiChunkEmitter.buildPersistedMessage(
          loadPersistedAssistantParts(uiChunkEmitter.messageId)
        );
        if (persistedContinuation) {
          await persistAssistantTurnMessage(
            deps.conversation,
            baseApprovalContext.plan.threadId,
            persistedContinuation,
            'approval-resume'
          );
        }
      }
      const continuationText = driver.getAccumulatedResponse() || streamResult.response;
      finalizeTurn({
        tracker: driver.getRunTracker(),
        outcome: streamResult.outcome,
        text: continuationText,
        ...(streamResult.usage ? { usage: streamResult.usage } : {}),
        ...(baseApprovalContext?.plan.threadId
          ? { threadId: baseApprovalContext.plan.threadId }
          : {}),
        transport: 'approval-resume',
        ...(persistedContinuation
          ? {
              committed: {
                messageId: persistedContinuation.id,
                message: persistedContinuation as never,
              },
            }
          : {}),
      });
      return {
        success: true,
        awaitingApproval: isAwaitingApproval,
        stopped: streamState.stoppedByUser,

        ...(session.recoveryContext?.plan.threadId
          ? { threadId: session.recoveryContext.plan.threadId }
          : {}),
        ...(streamResult.response ? { text: streamResult.response } : {}),
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const failingTracker = driverHandle?.getRunTracker() ?? resumeRunTracker;
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        if (failingTracker) {

          finalizeTurnCancelled({
            tracker: failingTracker,
            ...(failingTracker.getRun().threadId
              ? { threadId: failingTracker.getRun().threadId as string }
              : {}),
            transport: 'approval-resume',
            skipRow: failingTracker.getRun().status !== 'running',
            loudGuard: true,
          });
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }
      if (failingTracker) {
        const retry = runFailureFromError(error, message);
        finalizeTurnFailure({
          tracker: failingTracker,
          failure: {
            status: 'failed',
            errorText: message,
            ...(retry.code ? { code: retry.code } : {}),
            ...(typeof retry.retryable === 'boolean' ? { retryable: retry.retryable } : {}),
          },
          ...(failingTracker.getRun().threadId
            ? { threadId: failingTracker.getRun().threadId as string }
            : {}),
          transport: 'approval-resume',
          skipRow: failingTracker.getRun().status !== 'running',
          loudGuard: true,
        });
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (deps.streams.peek(resumedSenderId) === streamState && !isAwaitingApproval) {
        cleanupPendingSessionsForSender(resumedSenderId, resumeMessageId);
      }
      deps.streams.detach(resumedSenderId, streamState);
      execution?.dispose();
    }
  };

  const approveTool = async (
    target: ChatStreamTarget,
    approvalId: string,
    approved: boolean,
    reason?: string,
    source: ApprovalDecidedPayload['source'] = 'user'
  ) => {
    const pending = pendingApprovalSessions.get(approvalId);
    const record = toolCallApprovalDb.getToolCallApproval(approvalId);
    const storedSession = record
      ? toolCallApprovalDb.getToolCallApprovalSession(record.session_id)
      : null;
    const threadId = pending?.recoveryContext?.plan.threadId ?? storedSession?.thread_id;

    const executionAbort: { current: (() => void) | null; lost: boolean } = {
      current: null,
      lost: false,
    };
    const release = deps.streams.tryAcquireThreadRun(threadId, {
      onExecutionAbort: () => {
        executionAbort.lost = true;
        executionAbort.current?.();
      },
    });
    if (!release) return { success: false, error: 'A turn is already running on this thread.' };
    try {
      return await resumeApproval(target, approvalId, approved, reason, executionAbort, source);
    } finally {
      release();
    }
  };

  const cleanupPendingSessionsForSender = (senderId: number, sessionId?: string) => {
    for (const [key, session] of pendingApprovalSessions) {
      if (session.target.id === senderId && (!sessionId || session.sessionId === sessionId)) {
        clearApprovalTimeouts(session);
        pendingApprovalSessions.delete(key);
      }
    }
  };

  const cancelPendingApprovalsForRun = (runId: string): number => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return 0;

    const sessions = new Set(pendingApprovalSessions.values());
    for (const session of sessions) {
      if (session.recoveryContext?.runId !== normalizedRunId) continue;
      clearApprovalTimeouts(session);
      for (const approvalId of session.pendingApprovalIds) {
        pendingApprovalSessions.delete(approvalId);
      }
    }
    const expired = toolCallApprovalDb.expirePendingToolCallApprovalsByRunIds([normalizedRunId]);

    const expiredThreadId = expired
      .map(record => record.session_id)
      .filter((sessionId): sessionId is string => Boolean(sessionId))
      .map(sessionId => toolCallApprovalDb.getToolCallApprovalSession(sessionId)?.thread_id)
      .find(threadId => Boolean(threadId));
    const threadId =
      (typeof expiredThreadId === 'string' ? expiredThreadId : undefined) ??
      [...sessions.values()].find(session => session.recoveryContext?.runId === normalizedRunId)
        ?.recoveryContext?.plan.threadId;
    if (threadId && expired.length > 0) {
      recordFailureTerminalEvent(
        threadId,
        expired.map(record => ({
          type: APPROVAL_DECIDED,
          version: SESSION_EVENT_VERSION,
          payload: {
            approvalId: record.approval_id,
            approved: false,
            reason: 'Run cancelled; pending approval expired.',
            source: 'system' as const,
          },
        }))
      );
    }
    return expired.length;
  };

  return {
    approveTool,
    ensurePendingApprovalSession,
    registerApprovalBatch,
    cleanupPendingSessionsForSender,
    cancelPendingApprovalsForRun,
  };
};

export type ChatApproval = ReturnType<typeof createChatApproval>;
