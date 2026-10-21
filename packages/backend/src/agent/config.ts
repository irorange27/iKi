import { createLogger } from '@iki/backend/logger';
import {
  AgentConfigSchema,
  type AgentConfig,
  type PartialAgentConfig,
} from '@iki/backend/agent/types';

const configLogger = createLogger({ module: 'agent_config' });

const getDefaultAgentConfig = (): AgentConfig =>
  AgentConfigSchema.parse({
    enabled: false,
    systemPrompt: 'You are a helpful AI assistant. You are capable, autonomous, and helpful.',
    providerType: '',
    providerId: '',
    model: '',
    temperature: 0.1,
    maxTokens: 2000,
    maxIterations: 10,
    enableTools: false,
  });

export const loadAgentConfig = (overrideConfig?: PartialAgentConfig): AgentConfig => {
  const defaults = getDefaultAgentConfig();
  const merged: PartialAgentConfig = overrideConfig
    ? { ...defaults, ...overrideConfig }
    : defaults;

  try {
    return AgentConfigSchema.parse(merged);
  } catch (error) {
    // Retrying the same parse cannot succeed; the schema rejected this input.
    // Falling back to defaults keeps auxiliary callers (titles, summaries,
    // routing) alive instead of taking the caller down with it.
    configLogger.event({
      level: 'error',
      event: 'agent.config.parse',
      outcome: 'degraded',
      error,
      message: 'Agent config rejected; falling back to defaults.',
      data: { source: 'primary' },
    });
    return getDefaultAgentConfig();
  }
};

export const validateAgentConfig = (config: AgentConfig): void => {
  try {
    AgentConfigSchema.parse(config);
  } catch (error) {
    throw new Error(
      `Invalid agent configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  if (!config.enabled) {
    throw new Error('Agent is not enabled');
  }

  if (!config.providerType || !config.model) {
    throw new Error('Agent provider and model must be configured');
  }
};
