/**
 * Conversation-oriented agent framework entry point.
 * Includes backward-compatible exports while runtime boundaries are being narrowed.
 */

// Export all types
export type {
  AgentConfig,
  AgentMessage,
  AgentTool,
  AgentState,
  AgentResult,
  AgentUsage,
  ToolApprovalRequest,
  AgentHook,
  AgentHookContext,
  PartialAgentConfig,
} from './types';

export type {
  ConversationRunner,
  ConversationRunnerFactory,
  ConversationRunnerStreamEvent,
  ConversationRunnerStreamOptions,
} from './runners/conversation_runner';

// Export Zod schemas
export {
  AgentConfigSchema,
  AgentMessageSchema,
  AgentToolSchema,
  AgentStateSchema,
  AgentResultSchema,
  AgentHookContextSchema,
  PartialAgentConfigSchema,
} from './types';

// Export base class
export { BaseAgent } from './base';

// Export implementations
export { SimpleAgent } from '../iki_simple_agent';
export {
  SimpleConversationRunner,
  createSimpleConversationRunner,
} from './runners/simple_conversation_runner';

// Export tools
export * from '../tools';

// Export default implementation (for backward compatibility)
export {
  SimpleAgent as Agent,
  createAgent,
  getAgentConfig,
  getConversationRunnerConfig,
} from './agent';
