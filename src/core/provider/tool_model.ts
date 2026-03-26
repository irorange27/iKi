import { generateText } from 'ai';

import { getProviders } from '../db/providers';
import { getAppConfig } from '../config';
import { createLogger } from '../logger';
import { TitleAgent } from '../agents/title_agent';
import { LlmTitleRuntime, type TitleRuntime } from '../runtimes/title_runtime';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';
import { createModel } from './llm/factory';
import { parseModelList } from '../../shared/utils/provider_models';

export interface ToolModelConfig {
  providerType: string;
  model: string;
}

export interface ToolModelLatencyResult extends ToolModelConfig {
  responseTimeMs: number;
}

const toolModelLogger = createLogger({ module: 'tool_model' });

const findConfiguredToolModel = (
  providers: ReturnType<typeof getProviders>,
  config?: Partial<ToolModelConfig> | null
): ToolModelConfig | null => {
  const configuredModel = config?.model?.trim() || '';
  if (!configuredModel) return null;

  const enabledProviders = providers.filter(provider => provider.enabled);
  const configuredProviderType = config?.providerType?.trim() || '';

  if (configuredProviderType) {
    const provider = enabledProviders.find(candidate => candidate.type === configuredProviderType);
    if (!provider) return null;

    try {
      const models = parseModelList(provider.models);
      if (models.includes(configuredModel)) {
        return { providerType: configuredProviderType, model: configuredModel };
      }
    } catch {
      return null;
    }

    return null;
  }

  for (const provider of enabledProviders) {
    try {
      const models = parseModelList(provider.models);
      if (models.includes(configuredModel)) {
        return { providerType: provider.type, model: configuredModel };
      }
    } catch {
      continue;
    }
  }

  return null;
};

/**
 * Get Tool Model configuration with auto-detection
 * Priority: exact user config → legacy model-only config → auto-detect
 */
export const getToolModel = (): ToolModelConfig | null => {
  try {
    const config = getAppConfig();
    const providers = getProviders();
    const enabledProviders = providers.filter(p => p.enabled);

    const configuredToolModel = findConfiguredToolModel(providers, config?.toolModel);
    if (configuredToolModel) {
      return configuredToolModel;
    }

    const priorityOrder = ['openai', 'anthropic', 'google', 'deepseek'];
    const recommendedModels = [
      'gpt-4o-mini',
      'gpt-4o',
      'claude-3-5-haiku',
      'claude-3-haiku',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'deepseek-chat',
    ];

    for (const providerType of priorityOrder) {
      const provider = enabledProviders.find(p => p.type === providerType);
      if (provider) {
        try {
          const models = parseModelList(provider.models);
          const validModels = models.filter((m: string) => {
            const lower = m.toLowerCase();
            return !lower.includes('o1') && !lower.includes('o3') && !lower.includes('thinking');
          });

          for (const recommended of recommendedModels) {
            if (validModels.includes(recommended)) {
              return { providerType, model: recommended };
            }
          }

          if (validModels.length > 0) {
            return { providerType, model: validModels[0] };
          }
        } catch {
          continue;
        }
      }
    }

    if (enabledProviders.length > 0) {
      const provider = enabledProviders[0];
      try {
        const models = parseModelList(provider.models);
        if (models.length > 0) {
          return { providerType: provider.type, model: models[0] };
        }
      } catch {
        // Ignore
      }
    }

    return null;
  } catch (error) {
    toolModelLogger.error('Failed to get tool model', error);
    return null;
  }
};

export const testToolModelLatency = async (
  config?: Partial<ToolModelConfig> | null
): Promise<ToolModelLatencyResult> => {
  const hasExplicitSelection = Boolean(config?.providerType?.trim() || config?.model?.trim());
  const resolvedToolModel = hasExplicitSelection
    ? findConfiguredToolModel(getProviders(), config)
    : getToolModel();

  if (!resolvedToolModel) {
    throw new Error(
      hasExplicitSelection ? 'Selected tool model is unavailable.' : 'Tool model is unavailable.'
    );
  }

  const model = createModel(resolvedToolModel.providerType, resolvedToolModel.model);
  const startTime = Date.now();

  await generateText({
    model,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    maxOutputTokens: 8,
  });

  return {
    providerType: resolvedToolModel.providerType,
    model: resolvedToolModel.model,
    responseTimeMs: Math.max(Date.now() - startTime, 0),
  };
};

export type { TitleRuntime };
export { TitleAgent, LlmTitleRuntime };

export const createTitleAgent = (runtime: TitleRuntime) => new TitleAgent(runtime);

export const generateTitle = async (conversationContent: string): Promise<string | null> => {
  const agent = createTitleAgent(
    new LlmTitleRuntime({
      getToolModel,
      createGenerator: createSimplePromptTextGenerator,
    })
  );
  return agent.run(conversationContent);
};

export const generateTitleWithAgent = generateTitle;
