import { getAppConfig } from '../config';
import type { AgentConfig } from './types';

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
