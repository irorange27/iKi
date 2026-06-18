import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '../logger';
import type { AgentConfig } from './types';

const agentConfigLogger = createLogger({ module: 'agent_config' });

/**
 * Get conversation-runner configuration from app config.
 */
export function getConversationRunnerConfig(): AgentConfig | null {
  try {
    const appConfig = getAppConfig();
    if (!appConfig?.agent) return null;
    return {
      ...appConfig.agent,
      providerId: '',
    };
  } catch (error) {
    agentConfigLogger.error('Failed to get agent config', error);
    return null;
  }
}
