/**
 * Agent framework main entry point
 * Centralized exports for all agent-related functionality
 */

// Export all types
export type {
  AgentConfig,
  AgentMessage,
  AgentTool,
  AgentState,
  AgentResult,
  AgentHook,
  AgentHookContext,
  PartialAgentConfig,
} from './types';

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

// Export tools
export * from '../tools';

// Export default implementation (for backward compatibility)
export { SimpleAgent as Agent, createAgent, getAgentConfig } from './agent';
