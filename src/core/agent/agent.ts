/**
 * Conversation-runner compatibility entry point.
 * Kept for backward compatibility while chat orchestration moves to explicit runner naming.
 */

// Export types
export type {
  AgentConfig,
  AgentMessage,
  AgentTool,
  AgentState,
  AgentResult,
  AgentHook,
  AgentHookContext,
} from './types';

// Export base class
export { BaseAgent } from './base';

// Export implementations
export { SimpleAgent } from '../iki_simple_agent';

// Re-export for backward compatibility.
// Prefer `createSimpleConversationRunner` for new conversation orchestration code.
import { SimpleAgent } from '../iki_simple_agent';
/** @deprecated Use `createSimpleConversationRunner` for chat orchestration. */
export { SimpleAgent as Agent };

import { getAppConfig } from '../config';
import type { AgentConfig, PartialAgentConfig } from './types';

/** @deprecated Use `createSimpleConversationRunner` for chat orchestration. */
export function createAgent(config?: PartialAgentConfig) {
  return new SimpleAgent(config);
}

/**
 * Get conversation-runner configuration from app config.
 */
export function getConversationRunnerConfig(): AgentConfig | null {
  try {
    const appConfig = getAppConfig();
    return appConfig?.agent || null;
  } catch (error) {
    console.error('Failed to get agent config:', error);
    return null;
  }
}

/** @deprecated Use `getConversationRunnerConfig`. */
export function getAgentConfig(): AgentConfig | null {
  return getConversationRunnerConfig();
}
