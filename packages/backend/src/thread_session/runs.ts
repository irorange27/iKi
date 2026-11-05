import * as agentRunDb from '@iki/store/agent_runs';
import type { AgentRunStatus } from '@iki/core/types/agent_run';
import { createPrefixedId } from '@iki/core/utils/id';
import { rehydrateAgentRunTracker } from './run_tracker';
import { recordFailureTerminalEvent, TURN_STARTED, turnFactsToEvents } from './session_log';
import { getSessionEvents } from '@iki/store/session_events';

type ChatRunsDeps = {

  abortActiveStream: (runId: string) => boolean;

  cancelExecution?: (runId: string, reason: string) => boolean;

  hasLiveThreadLease?: (threadId: string) => boolean;
  cancelPendingApprovalsForRun?: (runId: string) => number;
};

const runHasStartedFact = (threadId: string, runId: string): boolean =>
  getSessionEvents(threadId, [TURN_STARTED], {
    path: '$.runId',
    value: runId,
  }).length > 0;

export const createChatRuns = (deps: ChatRunsDeps) => ({
  listRuns: (threadId: string) => agentRunDb.listAgentRunsByThread(threadId),

  listRunsByStatus: (statuses: AgentRunStatus[], opts?: { clientId?: string; limit?: number }) =>
    agentRunDb.listAgentRunsByStatus(statuses, opts),

  getRunTrace: (runId: string) => agentRunDb.getAgentRunTrace(runId),

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
