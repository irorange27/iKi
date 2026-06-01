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

// New AgentRunner v2 types (additive, coexists with legacy ConversationRunner)
export type {
  AgentStep,
  TextDeltaStep,
  ToolCallStartStep,
  ToolCallEndStep,
  ToolResultStep,
  ToolErrorStep,
  ApprovalRequestStep,
  ApprovalCollectedStep,
  HandoffStep,
  FinishStep,
  ErrorStep,
  AgentApprovalResponse,
} from './agent_step';

export type {
  AgentRunner,
  AgentRunnerRequest,
  AgentRunnerFactory,
} from './runners/agent_runner';

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

export { SimpleAgentRunner, createSimpleAgentRunner } from './runners/simple_agent_runner';
export { ClaudeCodeRunner, createClaudeCodeRunner } from './runners/claude_code_runner';

export { createAgentRunTracker } from './run_tracker';
export type { AgentRunTracker } from './run_tracker';

export { getConversationRunnerConfig } from './config';

// Export plan module
export type { Plan, PlanStep } from './plan';
export { createPlanThenExecutePrepareStep, composePrepareSteps } from './plan';

// Export tools
export * from '../tools';
