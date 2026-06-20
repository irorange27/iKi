import { createLogger } from '@iki/backend/logger';
import {
  AgentConfigSchema,
  type AgentConfig,
  type PartialAgentConfig,
} from '@iki/backend/agent/types';

const configLogger = createLogger({ module: 'ai_sdk_config' });

export const getDefaultAgentConfig = (): AgentConfig =>
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
    enableMemory: false,
  });

export const loadAgentConfig = (overrideConfig?: PartialAgentConfig): AgentConfig => {
  const defaults = getDefaultAgentConfig();
  const merged: PartialAgentConfig = overrideConfig
    ? { ...defaults, ...overrideConfig }
    : defaults;

  try {
    return AgentConfigSchema.parse(merged);
  } catch (error) {
    configLogger.event({
      level: 'error',
      event: 'agent.config.parse',
      outcome: 'failed',
      error,
      data: { source: 'primary' },
    });
    try {
      return AgentConfigSchema.parse({
        ...getDefaultAgentConfig(),
        ...(overrideConfig ?? {}),
      });
    } catch (parseError) {
      configLogger.event({
        level: 'error',
        event: 'agent.config.parse',
        outcome: 'degraded',
        error: parseError,
        message: 'Fallback agent config parsing failed; using defaults.',
        data: { source: 'fallback' },
      });
      return getDefaultAgentConfig();
    }
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
