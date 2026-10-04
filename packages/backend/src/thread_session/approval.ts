import { createLogger } from '@iki/backend/logger';
import type { ModelMessage, ToolApprovalResponse } from 'ai';

import { appendApprovalResponsesToHistory } from '../provider/ai_sdk_runtime';
import { cloneModelMessages, rehydrateHarness, type TurnDriverHarness } from '../agent/harness';
import { PiToolTurnHarness } from '../agent/runners/pi_tool_turn_harness';
import { pausedPlanRunsOnPiToolSupply } from './turn_supply_selection';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import * as chatMessageDb from '@iki/backend/db/chat_message';
import { createPrefixedId } from '../utils/id';
import type { ToolCallApprovalDecision } from '@iki/backend/types/tool_call_approval';
import { getErrorMessage } from '@iki/backend/utils/errors';
import type { ChatMemory } from './memory';
import type { ApprovalRecoveryContext } from './approval_types';
import { reidentifyPlan } from './approval_types';
import type { ExecutionPlan } from './execution_plan';
import { planToHarnessConfig, planToRunTrackerParams } from './execution_plan';
import { parseExecutionPlan, serializeExecutionPlan } from './execution_plan_codec';
import {
  recordSessionEvents,
  turnFactsToEvents,
  APPROVAL_REQUESTED,
  APPROVAL_DECIDED,
  SESSION_EVENT_VERSION,
  type ApprovalDecidedPayload,
} from './session_log';
import { createTurnDriver, finalizeRunForOutcome, runFailureFromError } from './turn_driver';
import { parseStoredWorkspaceSelection } from '../workspaces/thread_workspace';
import { deriveRunTurnPlan } from './run_rehydrator';
import { executeApprovedTool, prepareToolExecution } from './tool_execution';
export { executeApprovedTool, prepareToolExecution } from './tool_execution';
import {
  loadPersistedAssistantParts,
  persistAssistantTurnMessage,
} from './turn_persistence';
import {
  createAgentRunTracker,
  rehydrateAgentRunTracker,
} from './run_tracker';
import type { ActiveStreamState, ChatStreamTarget } from './types';
import { createUiChunkEmitter } from './ui_stream';
import { toModelInputMessages } from '@iki/backend/message/ui_messages';
import { parseStoredUiMessageRow } from '@iki/backend/message/ui_message_codec';

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

// Persisted plan snapshots go through the versioned codec (see
// execution_plan_codec.ts): unknown versions or structurally invalid
// payloads fall back to the legacy per-column derivation rather than
// fabricating an execution configuration.
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
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
};

export const createChatApproval = (deps: {
  /** Session-less stream registry access (owned by the stream coordinator). */
  streams: {
    tryAcquireThreadRun: (
      threadId?: string,
      options?: { onExecutionAbort?: () => void }
    ) => (() => void) | null;
    peek: (senderId: number) => ActiveStreamState | undefined;
    attach: (senderId: number, streamState: ActiveStreamState) => void;
    detach: (senderId: number, streamState: ActiveStreamState) => void;
  };
  memory: ChatMemory;
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

  const scheduleApprovalTimeout = (approvalId: string, session: PendingApprovalSession, delay = APPROVAL_TIMEOUT_MS) => {
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
        .catch(error => createLogger({ module: 'chat_approval' }).event({
          level: 'error', event: 'approval.timeout.failed', error,
        }));
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
      // The plan is the authority; the per-column fields are its persisted
      // projection (legacy readers and the legacy recovery path read them).
      const plan = recoveryContext.plan;
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
        max_iterations: plan.maxIterations ?? null,
        enabled_tools: JSON.stringify(plan.enabledTools),
        available_skill_ids: JSON.stringify(plan.availableSkillIds),
        // Turn-start workspace binding (D30): the resumed execution must
        // rebind this world, not the thread's current selection.
        workspace_selection:
          plan.workspaceSelection !== undefined
            ? JSON.stringify(plan.workspaceSelection)
            : null,
        // The full plan snapshot: a restart-recovered resume restores every
        // field from this instead of the lossy per-column derivation.
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

      // Session log: each pending approval is a business fact.
      if (recoveryContext.plan.threadId) {
        recordSessionEvents(
          recoveryContext.plan.threadId,
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
    const storedRunId = typeof approvalSession.run_id === 'string' ? approvalSession.run_id.trim() : '';
    const runSnapshot = storedRunId ? agentRunDb.getAgentRun(storedRunId) : null;
    const activeApprovalIds = activeApprovals.map(record => record.approval_id);
    const runPendingApprovalIds = new Set(runSnapshot?.working.pendingApprovalIds ?? []);
    const historyFromRun =
      runSnapshot &&
      (runSnapshot.status === 'blocked' ||
        activeApprovalIds.some(activeApprovalId => runPendingApprovalIds.has(activeApprovalId)))
        ? await toModelInputMessages(runSnapshot.working.modelMessages)
        : null;

    const threadId = runSnapshot?.threadId ?? approvalSession.thread_id;
    if (!threadId) return null;

    const inputMessages =
      historyFromRun && historyFromRun.length > 0
        ? historyFromRun
        : await (async () => {
            createLogger({ module: 'chat_approval' }).event({
              level: 'warn',
              event: 'chat.approval.resume_history',
              outcome: 'degraded',
              entity: { thread_id: threadId },
              message:
                'Approval resume fell back to the persisted UI history; run snapshot missing.',
              data: { run_id: storedRunId || null },
            });
            const rows = chatMessageDb.getChatMessages(threadId);
            if (rows.length === 0) return null;
            const uiMessages = rows.map(row =>
              parseStoredUiMessageRow({ id: row.id, message: row.message })
            );
            return await deps.memory.injectMemoryIntoMessages(
              // Keep non-terminal tool parts intact here: the pending
              // approval-request is live state the resumed harness must pair
              // with the user's approval response. Repairing it to an
              // interruption result makes the response reference an unknown
              // approvalId and the resume is rejected.
              await toModelInputMessages(uiMessages, { repairInterruptedTools: false }),
              threadId,
              { skipRetrieval: true }
            );
          })();

    if (!inputMessages || inputMessages.length === 0) return null;

    const parsedPlan = parseStoredPlan(approvalSession.plan_json);
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

    // Legacy rows: the plan is rebuilt from the run row layered over the
    // approval-session columns. Fields the columns never stored stay unset —
    // rows written after the plan_json column persist the exact plan.
    const plan: ExecutionPlan = parsedPlan ?? {
      providerType: derivedPlan.providerType,
      ...(derivedPlan.providerId ? { providerId: derivedPlan.providerId } : {}),
      model: derivedPlan.model,
      // The legacy resume always re-enabled tools (bypass tools ride along
      // via resolveTools even with an empty selection); keep that contract.
      enableTools: true,
      enabledTools: resolvedToolNames,
      availableSkillIds: derivedPlan.availableSkillIds,
      guardActive: false,
      requireApproval: derivedPlan.requireApproval ?? true,
      autoApproveToolRequests: false,
      ...(derivedPlan.approvalPolicy ? { approvalPolicy: derivedPlan.approvalPolicy } : {}),
      maxIterations: derivedPlan.maxIterations,
      // The run row may carry config the legacy columns never stored.
      ...(derivedPlan.reasoningEffort ? { reasoningEffort: derivedPlan.reasoningEffort } : {}),
      ...(derivedPlan.autonomous ? { autonomous: derivedPlan.autonomous } : {}),
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

    // Ensure the resumed stream emits UI chunks to the window that initiated the approval.
    session.target = target;

    const approvalResponse: ToolApprovalResponse = {
      type: 'tool-approval-response',
      approvalId,
      approved,
      reason: reason ?? (approved ? 'User approved tool execution.' : 'User rejected tool execution.'),
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

    if (session.collectedApprovalResponses.has(approvalId)) {
      const existing = session.collectedApprovalResponses.get(approvalId);
      // Idempotent: if the same decision was already recorded, treat as success
      if (existing && existing.approved === approved) {
        recordApprovalResponse();
        return { success: true };
      }
      return {
        success: false,
        error: 'Approval request already processed.',
      };
    }

    session.collectedApprovalResponses.set(approvalId, approvalResponse);
    const decision: ToolCallApprovalDecision = approved ? 'approved' : 'rejected';
    toolCallApprovalDb.answerToolCallApproval(approvalId, decision, approvalResponse.reason);
    recordApprovalResponse();

    // Session log: the decision is a business fact, whoever made it.
    const decidedThreadId =
      session.recoveryContext?.plan.threadId ??
      (() => {
        const stored = toolCallApprovalDb.getToolCallApprovalSession(
          toolCallApprovalDb.getToolCallApproval(approvalId)?.session_id ?? ''
        );
        return stored?.thread_id ?? null;
      })();
    if (decidedThreadId) {
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
    }

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

    // Pi resume admission (switch item 3b): admit the decided calls into the
    // owner's execution record BEFORE the legacy consume marks the rows —
    // a consumed row without execution evidence is 'unknown' by the owner's
    // contract, and the Pi resume must execute them. Right-to-act v2:
    // authorization (every call decided) + atomic admission, then consume.
    const piResumeAdmission = (() => {
      const pausedPlan = session.recoveryContext?.plan;
      const pausedHistory = cloneModelMessages(session.history ?? []);
      if (!pausedPlan?.threadId || !pausedPlanRunsOnPiToolSupply(pausedPlan, pausedHistory)) {
        return undefined;
      }
      // The guard covers command building AND admission: any failure
      // releases the just-collected decision so retrying the approval
      // re-attempts the resume instead of stalling in the idempotent branch.
      try {
        const commands = Array.from(session.pendingApprovalIds).flatMap((approvalId: string) => {
          const row = toolCallApprovalDb.getToolCallApproval(approvalId);
          // A row without its execution binding would leave the assistant's
          // tool call unanswered on the resumed wire — corruption, not a skip.
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

    // Continue the interrupted stream's message id: the resumed `start` chunk
    // then addresses the same assistant message instead of opening a second one
    // (idempotent accumulation on AI SDK clients keys on this id).
    const resumeMessageId =
      session.recoveryContext?.sessionId ?? createPrefixedId('assistant');
    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    if (executionAbort) {
      // The lease hook was registered synchronously with admission; wire it
      // to this execution's controller as soon as one exists. A loss that
      // already fired during the recovery awaits replays onto the controller.
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
    // The resumed execution runs under the paused turn's plan, re-identified
    // as its own child run — never a re-derivation from current config.
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
              modelMessages: session.history ?? [],
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
    if (resumePlan?.threadId) {
      // Session log: the continuation is its own run under the paused plan.
      recordSessionEvents(resumePlan.threadId, turnFactsToEvents({
        started: { runId: resumeRunTracker.id, kind: resumePlan.kind, plan: resumePlan },
      }));
    }
    deps.streams.attach(resumedSenderId, streamState);
    let isAwaitingApproval = false;
    // Set once the driver exists; the catch path must consult the driver's
    // CURRENT tracker (a handoff chain swaps it mid-turn).
    let driverHandle: ReturnType<typeof createTurnDriver> | null = null;

    try {
      const ctx = nextApprovalContext ?? session.recoveryContext;
      if (!ctx || !resumeRunTracker) {
        throw new Error('Approval resume requires the paused turn\'s recovery context');
      }

      // Supply selection (switch item 3b): a paused PI tool turn resumes on
      // the Pi harness — the decided calls were admitted into the owner's
      // execution record before the legacy consume (piResumeAdmission), the
      // owner's prepare here is an idempotent no-op, and executeApprovedTool
      // proceeds on the recorded facts. The AI SDK path keeps its
      // approval-response-part replay. guardActive stays off either way: the
      // plan's tool selection is already the guarded, post-preparation
      // result, and re-guarding could shrink it mid-turn.
      const resumesOnPi = Boolean(piResumeAdmission);
      const approvalHarness: TurnDriverHarness = resumesOnPi
        ? new PiToolTurnHarness(planToHarnessConfig(ctx.plan, { guardActive: false }), {
            resume: {
              commands: piResumeAdmission!.commands,
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
          })
        : rehydrateHarness(planToHarnessConfig(ctx.plan, { guardActive: false }));

      // Build history with collected approval responses — the AI SDK replay
      // only; the Pi harness consumes the RAW paused history (its projection
      // refuses approval parts) and pairs the decisions itself.
      const responses = Array.from(session.collectedApprovalResponses.values());
      let streamHistory = resumesOnPi
        ? cloneModelMessages(session.history ?? [])
        : cloneModelMessages(session.history ?? []);
      if (!resumesOnPi && responses.length > 0) {
        streamHistory = appendApprovalResponsesToHistory(
          streamHistory,
          responses.map(r => ({
            type: 'tool-approval-response' as const,
            approvalId: r.approvalId,
            approved: r.approved,
            ...(r.reason ? { reason: r.reason } : {}),
          }))
        );
      }

      // Mid-turn durable progress: a crash during a long resumed segment must
      // leave the executed tool results in the persisted UI history for the
      // fallback recovery branch. Seeded, or the write would replace the
      // row's pre-pause parts with the continuation segment alone.
      const persistResumeProgress = () => {
        const threadId = baseApprovalContext?.plan.threadId;
        if (!threadId) return;
        void uiChunkEmitter
          .buildPersistedMessage(loadPersistedAssistantParts(uiChunkEmitter.messageId))
          .then(persisted =>
            persisted
              ? persistAssistantTurnMessage(deps.conversation, threadId, persisted, 'stream-progress')
              : undefined
          );
      };

      // The continuation rides the same turn driver as streaming — same step
      // projection, approval registration and finalize contracts. The attach
      // stays session-less: stoppable and run-cancellable, deliberately not
      // steerable (the steer queue does not survive the pause yet).
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

      // The driver's CURRENT tracker/harness: a handoff chain finalizes the
      // child segment, not the completed parent.
      const finalTracker = driver.getRunTracker();
      finalTracker.syncModelMessages(driver.getHarness().getHistory() ?? session.history ?? []);
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
      finalizeRunForOutcome(driver.getRunTracker(), streamResult, {
        text: driver.getAccumulatedResponse() || streamResult.response,
      });
      if (baseApprovalContext?.plan.threadId) {
        // Seed the reduction with the already-persisted pre-pause parts so the
        // accumulated message stays whole across the pause, then upsert.
        const persisted = await uiChunkEmitter.buildPersistedMessage(
          loadPersistedAssistantParts(uiChunkEmitter.messageId)
        );
        if (persisted) {
          await persistAssistantTurnMessage(
            deps.conversation,
            baseApprovalContext.plan.threadId,
            persisted,
            'approval-resume'
          );
        }
        // Session log: the continuation's committed output; a re-pause is not
        // terminal (its next continuation records its own facts). The final
        // tracker's identity pairs with the final status — a handoff chain
        // finishes in the child segment.
        const finalResumeTracker = driver.getRunTracker();
        const resumedStatus = finalResumeTracker.getRun().status;
        recordSessionEvents(
          baseApprovalContext.plan.threadId,
          turnFactsToEvents({
            ...(persisted
              ? {
                  committed: {
                    runId: finalResumeTracker.id,
                    messageId: persisted.id,
                    message: persisted as never,
                    transport: 'approval-resume',
                  },
                }
              : {}),
            ...(resumedStatus === 'completed' || resumedStatus === 'failed' || resumedStatus === 'cancelled'
              ? {
                  terminal: {
                    runId: finalResumeTracker.id,
                    status: resumedStatus,
                  },
                }
              : {}),
          })
        );
      }
      return {
        success: true,
        awaitingApproval: isAwaitingApproval,
        stopped: streamState.stoppedByUser,
        // Exposed as the approve-result wire payload (the continuation reply
        // is already durably persisted by the backend turn-persistence seam
        // above, under the same assistant message id).
        ...(session.recoveryContext?.plan.threadId ? { threadId: session.recoveryContext.plan.threadId } : {}),
        ...(streamResult.response ? { text: streamResult.response } : {}),
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const failingTracker = driverHandle?.getRunTracker() ?? resumeRunTracker;
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        if (failingTracker && failingTracker.getRun().status === 'running') {
          failingTracker.markCancelled();
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }
      if (failingTracker && failingTracker.getRun().status === 'running') {
        failingTracker.markFailed(runFailureFromError(error, message));
      }
      const failedThreadId = failingTracker?.getRun().threadId;
      if (failedThreadId) {
        recordSessionEvents(failedThreadId, turnFactsToEvents({
          terminal: { runId: failingTracker.id, status: 'failed', errorText: message },
        }));
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (deps.streams.peek(resumedSenderId) === streamState && !isAwaitingApproval) {
        cleanupPendingSessionsForSender(resumedSenderId, resumeMessageId);
      }
      deps.streams.detach(resumedSenderId, streamState);
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
    const storedSession = record ? toolCallApprovalDb.getToolCallApprovalSession(record.session_id) : null;
    const threadId = pending?.recoveryContext?.plan.threadId ?? storedSession?.thread_id;
    // The execution abort hook is registered synchronously with admission so
    // a lease loss during the async resume-recovery below still reaches the
    // resumed execution once its controller exists. `lost` records a loss
    // that fired before the wiring (the holder is the only cross-await state
    // here), so the wiring can replay it instead of silently dropping it.
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
    // Session log: the run's cancellation is a system decision on each of its
    // pending approvals — replay must not keep them pending forever.
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
      recordSessionEvents(
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
