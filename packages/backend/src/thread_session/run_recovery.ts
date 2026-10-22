import { listAgentRunsByStatus } from '@iki/backend/db/agent_runs';
import {
  MESSAGE_EVENT_TYPES,
  appendSessionFacts,
  getSessionEvents,
} from '@iki/backend/db/session_events';
import { hasLiveThreadRunLease } from '@iki/backend/db/thread_run_locks';
import {
  APPROVAL_REQUESTED,
  APPROVAL_DECIDED,
  recordFailureTerminalEvent,
  SESSION_EVENT_VERSION,
  turnFactsToEvents,
} from './session_log';
import type { DynamicToolPart } from '@iki/backend/message/tool_parts';
import {
  APPROVAL_PENDING_INTERRUPTED_ERROR_TEXT,
  isObjectRecord,
  isTerminalDynamicToolPart,
  toInterruptedToolPart,
} from '@iki/backend/message/tool_parts';
import type { AgentRunStatus } from '@iki/backend/types/agent_run';
import { rehydrateAgentRunTracker } from './run_tracker';

export type RunRecoveryResult = {
  failedRuns: number;
  blockedRuns: number;
  totalRuns: number;
  interruptedToolParts: number;

  skippedLiveLease: number;
};

export const recoverStuckRunsOnStartup = (): RunRecoveryResult => {
  const stuckStatuses: AgentRunStatus[] = ['running', 'blocked'];
  const runs = listAgentRunsByStatus(stuckStatuses);
  let failedRuns = 0;
  let blockedRuns = 0;
  let skippedLiveLease = 0;

  const reclaimable = runs.filter(run => {
    if (run.threadId && hasLiveThreadRunLease(run.threadId)) {
      skippedLiveLease += 1;
      return false;
    }
    return true;
  });

  const threadIds = Array.from(
    new Set(reclaimable.map(run => run.threadId).filter((id): id is string => typeof id === 'string'))
  );

  // A run interrupted while an approval was pending leaves its tool call with no
  // committed part at all: the crash happened before MODEL_OUTPUT_COMMITTED, so the
  // transcript would otherwise show the assistant text and then nothing. The call
  // is recoverable from the APPROVAL_REQUESTED event that named it. Commit one
  // terminal error per such call, appended as a superseding MODEL_OUTPUT_COMMITTED
  // so the log stays append-only and the projection picks the newest commit.
  let interruptedToolParts = 0;
  for (const threadId of threadIds) {
    const rejected = new Map<string, { toolCallId: string; toolName: string; args: unknown }>();
    for (const event of getSessionEvents(threadId, [APPROVAL_REQUESTED])) {
      const payload = event.payload as {
        sessionId?: unknown;
        toolCallId?: unknown;
        toolName?: unknown;
        args?: unknown;
      };
      if (typeof payload?.sessionId !== 'string' || typeof payload.toolCallId !== 'string') continue;
      rejected.set(`${payload.sessionId}::${payload.toolCallId}`, {
        toolCallId: payload.toolCallId,
        toolName: typeof payload.toolName === 'string' ? payload.toolName : 'tool',
        args: payload.args,
      });
    }
    if (rejected.size === 0) continue;

    const committed = new Map<string, { messageId: string; message: Record<string, unknown> }>();
    for (const event of getSessionEvents(threadId, [MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED])) {
      const payload = event.payload as { messageId?: unknown; message?: unknown };
      if (typeof payload?.messageId !== 'string' || !isObjectRecord(payload.message)) continue;
      committed.set(payload.messageId, { messageId: payload.messageId, message: payload.message });
    }

    for (const [key, call] of rejected) {
      const sessionId = key.split('::')[0];
      const target = committed.get(sessionId);
      if (!target) continue;
      const parts = Array.isArray(target.message.parts) ? target.message.parts : [];
      const alreadyTerminal = parts.some(
        part =>
          isObjectRecord(part) &&
          part.type === 'dynamic-tool' &&
          (part as { toolCallId?: unknown }).toolCallId === call.toolCallId &&
          isTerminalDynamicToolPart(part as unknown as DynamicToolPart)
      );
      if (alreadyTerminal) continue;

      interruptedToolParts += 1;
      appendSessionFacts(threadId, [
        {
          type: MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED,
          version: SESSION_EVENT_VERSION,
          payload: {
            runId: '',
            messageId: target.messageId,
            message: {
              ...target.message,
              parts: [
                ...parts,
                toInterruptedToolPart(
                  {
                    type: 'dynamic-tool',
                    toolCallId: call.toolCallId,
                    toolName: call.toolName,
                    state: 'approval-requested',
                    input: call.args ?? {},
                  } as unknown as DynamicToolPart,
                  APPROVAL_PENDING_INTERRUPTED_ERROR_TEXT
                ),
              ],
            },
            transport: 'stream',
          },
        },
      ]);
    }
  }

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

    // A run reclaimed while blocked was waiting on an approval whose session
    // died with its process. The transcript must show that decision, or the
    // replayed turn ends with a proposal nobody ever answered.
    if (run.status === 'blocked' && run.threadId) {
      const proposals = getSessionEvents(run.threadId, [APPROVAL_REQUESTED], {
        path: '$.runId',
        value: run.id,
      });
      if (proposals.length > 0) {
        recordFailureTerminalEvent(
          run.threadId,
          proposals.map(event => ({
            type: APPROVAL_DECIDED,
            version: SESSION_EVENT_VERSION,
            payload: {
              approvalId: (event.payload as { approvalId: string }).approvalId,
              approved: false,
              reason: 'Run reclaimed by startup recovery; the approval session died with its process.',
              source: 'system' as const,
            },
          }))
        );
      }
    }

    if (run.threadId) {
      recordFailureTerminalEvent(run.threadId, turnFactsToEvents({
        terminal: {
          runId: run.id,
          status: 'failed',
          errorText: params.message,
        },
      }));
    }
  }

  return {
    failedRuns,
    blockedRuns,
    totalRuns: reclaimable.length,
    interruptedToolParts,
    skippedLiveLease,
  };
};
