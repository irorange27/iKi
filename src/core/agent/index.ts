/**
 * Conversation-oriented agent runtime entry point.
 */

// Export current public types
export type {
  AgentConfig,
  AgentTool,
  AgentResult,
  AgentUsage,
  ToolApprovalRequest,
  PartialAgentConfig,
} from './types';

export type {
  ConversationRunner,
  ConversationRunnerFactory,
  ConversationRunnerGenerateRequest,
  ConversationRunnerRequest,
  ConversationRunnerStreamEvent,
  ConversationRunnerStreamRequest,
  ConversationRunnerStreamOptions,
} from './runners/conversation_runner';

export type { ConversationHarness } from './harnesses/conversation_harness';

// Export current public schemas
export {
  AgentConfigSchema,
  AgentToolSchema,
  AgentResultSchema,
  PartialAgentConfigSchema,
} from './types';

// Export implementations
export {
  SimpleConversationRunner,
  createSimpleConversationRunner,
} from './runners/simple_conversation_runner';

export { createConversationHarness } from './harnesses/conversation_harness';
export { createAgentRunTracker } from './run_tracker';
export type { AgentRunTracker } from './run_tracker';

export { getConversationRunnerConfig } from './config';

// Export tools
export * from '../tools';
