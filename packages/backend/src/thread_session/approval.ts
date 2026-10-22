import { createLogger } from '@iki/backend/logger';
import type { ModelMessage, ToolApprovalResponse } from '@iki/backend/message/model_history';

import { cloneModelMessages } from '../agent/harness';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import type { ToolCallApprovalDecision } from '@iki/backend/types/tool_call_approval';
import type { ApprovalRecoveryContext } from './approval_types';
import {
  recordFailureTerminalEvent,
  recordSessionEvents,
  APPROVAL_DECIDED,
  SESSION_EVENT_VERSION,
  type ApprovalDecidedPayload,
} from './session_log';
import { recoverApprovalSession } from './approval_recovery';
import { persistApprovalBatch } from './approval_persistence';
import { admitPiResume } from './pi_resume_admission';
import { executeApprovalResume } from './approval_resume_execution';
import type { PendingApprovalSession } from './approval_session';
import { rehydrateAgentRunTracker } from './run_tracker';
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
      persistApprovalBatch({
        requests: approvalRequests,
        recoveryContext: session.recoveryContext,
      });
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
    const recovered = await recoverApprovalSession(approvalId);
    if (!recovered) return null;
    const session: PendingApprovalSession = {
      ...recovered,
      target,
      timeouts: new Map(),
    };
    for (const id of session.pendingApprovalIds) {
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
      (storedApproval
        ? (toolCallApprovalDb.getToolCallApprovalSession(storedApproval.session_id)?.thread_id ??
          null)
        : null);
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

    const piResumeAdmission = admitPiResume({
      plan: session.recoveryContext?.plan,
      history: cloneModelMessages(session.history ?? []),
      pendingApprovalIds: session.pendingApprovalIds,
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
