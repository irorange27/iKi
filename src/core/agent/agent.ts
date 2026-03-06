/**
 * Agent framework entry point
 * Re-exports all types and implementations
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

// Re-export for backward compatibility
// Agent is now an alias for LLMAgent (the default implementation)
import { SimpleAgent } from '../iki_simple_agent';
export { SimpleAgent as Agent };

import { getConfig } from '../db/database';
import type { AppConfig } from '../../shared/types/config';
import type { AgentConfig, PartialAgentConfig } from './types';

/**
 * Create a new agent instance (defaults to LLMAgent)
 * @param config - Optional agent configuration (validated with Zod)
 * @returns A new Agent instance
 */
export function createAgent(config?: PartialAgentConfig) {
  return new SimpleAgent(config);
}

/**
 * Get agent configuration from app config
 */
export function getAgentConfig(): AgentConfig | null {
  try {
    const appConfig = getConfig('app_config') as AppConfig | null;
    return appConfig?.agent || null;
  } catch (error) {
    console.error('Failed to get agent config:', error);
    return null;
  }
}
