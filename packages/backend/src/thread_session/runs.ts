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
import { buildRunTrajectory, type AtifTrajectory } from './atif_export';

type ChatRunsDeps = {
  /** Aborts the active stream running a run id (owned by the stream coordinator). */
  abortActiveStream: (runId: string) => boolean;
  /**
   * Cancels the live execution owning a run id — the run-keyed registration
   * that covers send and approval-resume executions too, not only streams.
   * Returns false when no live execution in this process owns the run.
   */
  cancelExecution?: (runId: string, reason: string) => boolean;
  cancelPendingApprovalsForRun?: (runId: string) => number;
};

const REVIEW_QUEUE_KINDS: AgentRunKind[] = ['proactive-task', 'awaiter-wake'];
const SUMMARY_MAX_CHARS = 280;

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

  /** Structured ATIF trajectory (same data the file export writes, returned inline for UI rendering). */
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

    // Cancellation names a run and must reach the execution that owns it.
    // The run-keyed index covers every entry that can execute a run —
    // stream, send and approval resume — where the stream registry only
    // covers subscribed senders. The owning execution persists its own
    // terminal state through the shared finalize path.
    const reachedExecution = deps.cancelExecution
      ? deps.cancelExecution(runId, 'run-cancelled')
      : deps.abortActiveStream(runId);
    if (!reachedExecution) {
      // No live execution in this process owns the run. Writing `cancelled`
      // here would be a terminal fact nobody caused: a run may be executing
      // in another process (desktop + daemon share this database) or have
      // died with its process. Refuse and let reconciliation decide, rather
      // than reporting a stop that did not happen.
      return {
        success: false,
        error:
          'No live execution owns this run in this process. If it is running elsewhere, cancel it there; otherwise it will be reconciled on startup.',
      };
    }
    deps.cancelPendingApprovalsForRun?.(runId);

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
      // The successor keeps the original's kind — a retried wake/task run is
      // still a wake/task run (issue #139 attribution).
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

export type ChatRuns = ReturnType<typeof createChatRuns>;
