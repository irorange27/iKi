import * as agentRunDb from '../../../core/db/agent_runs';

export const createChatRuns = () => ({
  listRuns: (threadId: string) => agentRunDb.listAgentRunsByThread(threadId),
  getRunTrace: (runId: string) => agentRunDb.getAgentRunTrace(runId),
  getRunTree: (rootRunId: string) => agentRunDb.getAgentRunTree(rootRunId),
});

export type ChatRuns = ReturnType<typeof createChatRuns>;
