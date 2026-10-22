import { createLogger } from '@iki/backend/logger';
import type { ModelMessage, ToolApprovalResponse } from '@iki/backend/message/model_history';

import { cloneModelMessages } from '../agent/harness';
import type { ApprovalRecoveryContext } from './approval_types';
import {
  recordFailureTerminalEvent,
  recordSessionEvents,
  APPROVAL_REQUESTED,
  APPROVAL_DECIDED,
  SESSION_EVENT_VERSION,
  type ApprovalDecidedPayload,
} from './session_log';
import { admitPiResume } from './pi_resume_admission';
import { executeApprovalResume } from './approval_resume_execution';
import type { ApprovalBinding, PendingApprovalSession } from './approval_session';
import { rehydrateAgentRunTracker } from './run_tracker';
import { registerApprovalBinding } from './tool_execution';
import type { ActiveStreamState, ChatStreamTarget } from './types';

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;


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
    if (session.timeouts) {
      for (const timeoutId of session.timeouts.values()) clearTimeout(timeoutId);
      session.timeouts.clear();
    }
    for (const release of session.releases ?? []) release();
    session.releases = [];
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
      bindings: new Map(),
      releases: [],
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

    const context = session.recoveryContext;
    if (context?.plan.threadId) {
      // The proposal is an audit fact, not a resumable checkpoint: it records
      // what was asked so the transcript explains the pause.
      recordSessionEvents(
        context.plan.threadId,
        approvalRequests.map(request => ({
          type: APPROVAL_REQUESTED,
          version: SESSION_EVENT_VERSION,
          payload: {
            approvalId: request.approvalId,
            sessionId: context.sessionId,
            ...(context.runId ? { runId: context.runId } : {}),
            ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
            ...(request.toolCall?.toolName ? { toolName: request.toolCall.toolName } : {}),
            ...(request.toolCall?.args ? { args: request.toolCall.args } : {}),
          },
        }))
      );
    }

    const bindingReleases: Array<() => void> = [];
    const newBindings = new Map<string, ApprovalBinding>();
    for (const request of approvalRequests) {
      if (!request.toolCall || !context) continue;
      const binding: ApprovalBinding = {
        approvalId: request.approvalId,
        messageId: context.assistantMessageId,
        toolCallId: request.toolCallId ?? '',
        toolName: request.toolCall.toolName,
        args: request.toolCall.args ?? {},
        workspace:
          context.plan.workspaceSelection !== undefined
            ? JSON.stringify(context.plan.workspaceSelection)
            : null,
      };
      newBindings.set(request.approvalId, binding);
      bindingReleases.push(registerApprovalBinding({ ...binding, threadId: context.plan.threadId ?? '' }));
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
      existingSession.releases.push(...bindingReleases);
      for (const [approvalId, binding] of newBindings) {
        existingSession.bindings.set(approvalId, binding);
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
      bindings: newBindings,
      releases: bindingReleases,
      timeouts: new Map(),
    };

    for (const approvalId of approvalIds) {
      pendingApprovalSessions.set(approvalId, pendingSession);
      scheduleApprovalTimeout(approvalId, pendingSession);
    }
  };

  const resumeApproval = async (
    target: ChatStreamTarget,
    approvalId: string,
    approved: boolean,
    reason?: string,
    executionAbort?: { current: (() => void) | null; lost: boolean },
    source: ApprovalDecidedPayload['source'] = 'user'
  ) => {
    const session = pendingApprovalSessions.get(approvalId);
    if (!session) {
      // A pause is memory-only by design: if the process that asked is gone, the
      // decision has nowhere to land and the turn is over.
      return {
        success: false,
        error: 'Approval request not found. A paused turn does not survive a restart.',
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
      const runId = session.recoveryContext?.runId;
      if (!runId) return;
      const binding = session.bindings.get(approvalId);
      rehydrateAgentRunTracker(runId)?.recordApprovalResponse({
        approvalId,
        ...(binding ? { toolCallId: binding.toolCallId } : {}),
        approved,
        reason: approvalResponse.reason,
      });
    };

    const decidedThreadId = session.recoveryContext?.plan.threadId ?? null;
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

    const piResumeAdmission = admitPiResume({
      plan: session.recoveryContext?.plan,
      history: cloneModelMessages(session.history ?? []),
      pendingApprovalIds: session.pendingApprovalIds,
      bindings: session.bindings,
      onRefuse: () => session.collectedApprovalResponses.delete(approvalId),
    });

    return executeApprovalResume(
      { session, approvalId, piResumeAdmission, ...(executionAbort ? { executionAbort } : {}) },
      {
        streams: deps.streams,
        conversation: deps.conversation,
        usage: deps.usage,
        ensurePendingApprovalSession,
        registerApprovalBatch,
        clearApprovalTimeouts,
        cleanupPendingSessionsForSender,
        forgetSession: target => {
          for (const pendingId of target.pendingApprovalIds) pendingApprovalSessions.delete(pendingId);
        },
      }
    );
  };

  const approveTool = async (
    target: ChatStreamTarget,
    approvalId: string,
    approved: boolean,
    reason?: string,
    source: ApprovalDecidedPayload['source'] = 'user'
  ) => {
    const threadId = pendingApprovalSessions.get(approvalId)?.recoveryContext?.plan.threadId;

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

    const expired: Array<{ approvalId: string; threadId?: string }> = [];
    for (const session of new Set(pendingApprovalSessions.values())) {
      if (session.recoveryContext?.runId !== normalizedRunId) continue;
      clearApprovalTimeouts(session);
      for (const approvalId of session.pendingApprovalIds) {
        pendingApprovalSessions.delete(approvalId);
        expired.push({
          approvalId,
          ...(session.recoveryContext?.plan.threadId
            ? { threadId: session.recoveryContext.plan.threadId }
            : {}),
        });
      }
    }

    const threadId = expired.find(entry => entry.threadId)?.threadId;
    if (threadId) {
      recordFailureTerminalEvent(
        threadId,
        expired.map(entry => ({
          type: APPROVAL_DECIDED,
          version: SESSION_EVENT_VERSION,
          payload: {
            approvalId: entry.approvalId,
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
