import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/ai/provider/tool_model';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';

export const delegatedAgentRuntime = {
  createRunTracker: createAgentRunTracker,
  getConversationToolModel: getToolModel,
  createHarness: startPiTurnHarness,
};
