import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import * as tasksDb from '@iki/backend/db/tasks';
import type {
  AgentRun,
  AgentRunKind,
  AgentRunStatus,
  ReviewQueueItem,
} from '@iki/backend/types/agent_run';
import { createPrefixedId } from '@iki/backend/utils/id';
import { rehydrateAgentRunTracker } from './run_tracker';
import { recordFailureTerminalEvent, TURN_STARTED, turnFactsToEvents } from './session_log';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { buildRunTrajectory, type AtifTrajectory } from './atif_export';

type ChatRunsDeps = {

  abortActiveStream: (runId: string) => boolean;

  cancelExecution?: (runId: string, reason: string) => boolean;

  hasLiveThreadLease?: (threadId: string) => boolean;
  cancelPendingApprovalsForRun?: (runId: string) => number;
};

const REVIEW_QUEUE_KINDS: AgentRunKind[] = ['proactive-task', 'awaiter-wake'];
const SUMMARY_MAX_CHARS = 280;

const runHasStartedFact = (threadId: string, runId: string): boolean =>
  getSessionEvents(threadId, [TURN_STARTED], {
    path: '$.runId',
    value: runId,
  }).length > 0;

const buildReviewQueueItem = (run: AgentRun): ReviewQueueItem => {
  const thread = run.threadId ? chatThreadDb.getChatThread(run.threadId) : null;
  const metadata = (run.input?.metadata ?? {}) as Record<string, unknown>;
  const taskId = typeof metadata.taskId === 'string' ? metadata.taskId : '';
  const task = taskId ? tasksDb.getProactiveTask(taskId) : null;
  const summarySource = run.output?.text || run.working?.accumulatedText || '';
  const truncated =
    summarySource.length > SUMMARY_MAX_CHARS
      ? `${summarySource.slice(0, SUMMARY_MAX_CHARS).trimEnd()}…`
      : summarySource;

  return {
    runId: run.id,
    kind: run.kind,
    status: run.status,
    threadId: run.threadId,
    threadTitle: thread?.title || undefined,
    taskName: task?.name || taskId || undefined,
    startedAt: run.createdAt,
    updatedAt: run.updatedAt,
    summary: truncated,
    error: run.error?.message,
  };
};

export const listReviewQueue = (limit = 20): ReviewQueueItem[] =>
  agentRunDb
    .listAgentRunsByKinds(REVIEW_QUEUE_KINDS, {
      statuses: ['completed', 'failed'],
      limit,
    })
    .map(buildReviewQueueItem);

export const createChatRuns = (deps: ChatRunsDeps) => ({
  listRuns: (threadId: string) => agentRunDb.listAgentRunsByThread(threadId),

  listRunsByStatus: (statuses: AgentRunStatus[], opts?: { clientId?: string; limit?: number }) =>
    agentRunDb.listAgentRunsByStatus(statuses, opts),

  listReviewQueue: (limit?: number) => listReviewQueue(limit),

  getRunTrace: (runId: string) => agentRunDb.getAgentRunTrace(runId),

  getRunTrajectory: (runId: string): AtifTrajectory | null => {
    const trace = agentRunDb.getAgentRunTrace(runId);
    if (!trace) return null;
    return buildRunTrajectory(trace.run, trace.steps);
  },

  getRunTree: (rootRunId: string) => agentRunDb.getAgentRunTree(rootRunId),

  cancelRun: (runId: string): { success: boolean; error?: string } => {
    const run = agentRunDb.getAgentRun(runId);
    if (!run) return { success: false, error: 'Run not found' };

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return { success: false, error: `Run is already ${run.status}` };
    }

    const reachedExecution = deps.cancelExecution
      ? deps.cancelExecution(runId, 'run-cancelled')
      : deps.abortActiveStream(runId);
    if (reachedExecution) {
      deps.cancelPendingApprovalsForRun?.(runId);
      return { success: true };
    }

    if (run.status === 'running') {
      const leaseHeldElsewhere =
        Boolean(run.threadId) && deps.hasLiveThreadLease?.(run.threadId as string) === true;
      if (leaseHeldElsewhere) {

        return {
          success: false,
          error:
            'This run is owned by another live process. Cancel it there — this process cannot stop it.',
        };
      }

      const reclaimed = rehydrateAgentRunTracker(runId);
      if (!reclaimed) {
        return { success: false, error: `Run ${runId} could not be loaded to cancel.` };
      }
      deps.cancelPendingApprovalsForRun?.(runId);
      reclaimed.markCancelled({
        text: run.output?.text ?? run.working.accumulatedText,
      });
      if (run.threadId && runHasStartedFact(run.threadId, runId)) {
        recordFailureTerminalEvent(run.threadId, turnFactsToEvents({
          terminal: { runId, status: 'cancelled' },
        }));
      }
      return {
        success: true,
        error:
          'No live execution owned this run, so it was reclaimed as cancelled. Nothing was running.',
      };
    }

    deps.cancelPendingApprovalsForRun?.(runId);
    const tracker = rehydrateAgentRunTracker(runId);
    if (!tracker) {
      return { success: false, error: `Run ${runId} could not be loaded to cancel.` };
    }
    tracker.markCancelled({
      text: run.output?.text ?? run.working.accumulatedText,
    });

    if (run.threadId && runHasStartedFact(run.threadId, runId)) {
      recordFailureTerminalEvent(run.threadId, turnFactsToEvents({
        terminal: { runId, status: 'cancelled' },
      }));
    }

    return { success: true };
  },

  retryRun: (runId: string): { success: boolean; error?: string; newRunId?: string } => {
    const original = agentRunDb.getAgentRun(runId);
    if (!original) return { success: false, error: 'Run not found' };

    if (original.status !== 'failed' && original.status !== 'cancelled') {
      return { success: false, error: `Cannot retry a run with status ${original.status}` };
    }

    const newRunId = createPrefixedId('run');
    agentRunDb.createAgentRun({
      id: newRunId,

      kind: original.kind,
      status: 'queued',
      threadId: original.threadId,
      parentRunId: original.id,
      rootRunId: original.rootRunId,
      providerType: original.providerType,
      providerId: original.providerId,
      model: original.model,
      systemPrompt: original.systemPrompt,
      enabledTools: original.enabledTools,
      availableSkillIds: original.availableSkillIds,
      input: {
        ...original.input,
        metadata: {
          ...(original.input.metadata ?? {}),
          retryOf: original.id,
        },
      },
      working: original.working,
      output: null,
      error: null,
    });

    return { success: true, newRunId };
  },
});
