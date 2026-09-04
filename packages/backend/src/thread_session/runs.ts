import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { AgentRunStatus } from '@iki/backend/types/agent_run';
import { createPrefixedId } from '@iki/backend/utils/id';

type ChatRunsDeps = {
  /** Aborts the active stream running a run id (owned by the stream coordinator). */
  abortActiveStream: (runId: string) => void;
};

export const createChatRuns = (deps: ChatRunsDeps) => ({
  listRuns: (threadId: string) => agentRunDb.listAgentRunsByThread(threadId),

  listRunsByStatus: (statuses: AgentRunStatus[], opts?: { clientId?: string; limit?: number }) =>
    agentRunDb.listAgentRunsByStatus(statuses, opts),

  getRunTrace: (runId: string) => agentRunDb.getAgentRunTrace(runId),

  getRunTree: (rootRunId: string) => agentRunDb.getAgentRunTree(rootRunId),

  cancelRun: (runId: string): { success: boolean; error?: string } => {
    const run = agentRunDb.getAgentRun(runId);
    if (!run) return { success: false, error: 'Run not found' };

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return { success: false, error: `Run is already ${run.status}` };
    }

    agentRunDb.updateAgentRun(runId, {
      status: 'cancelled',
      output: run.output
        ? { ...run.output, finishReason: 'cancelled' }
        : { text: '', finishReason: 'cancelled' },
    });

    deps.abortActiveStream(runId);

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
      kind: 'chat-turn',
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
