import { generateText } from 'ai';

import { getProviders } from '../db/providers';
import { getAppConfig } from '../config';
import { createLogger } from '../logger';
import { TitleAgent } from '../agents/title_agent';
import { LlmTitleRuntime, type TitleRuntime } from '../runtimes/title_runtime';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';
import { createModel, getModelCallSettings } from './llm/factory';
import { parseModelList } from '../../shared/utils/provider_models';

export interface ToolModelConfig {
  providerType: string;
  providerId?: string;
  model: string;
}

export interface ToolModelLatencyResult extends ToolModelConfig {
  responseTimeMs: number;
}

const toolModelLogger = createLogger({ module: 'tool_model' });

type ToolModelSelectionInput = {
  providerId?: string;
  providerType?: string;
  model?: string;
};

type StoredProvider = ReturnType<typeof getProviders>[number];

const resolveProviderModels = (provider: StoredProvider): string[] | null => {
  try {
    return parseModelList(provider.models);
  } catch {
    return null;
  }
};

const resolveExplicitToolModel = (
  enabledProviders: StoredProvider[],
  config: ToolModelSelectionInput
): ToolModelConfig | null => {
  const configuredModel = config.model?.trim() || '';
  if (!configuredModel) return null;

  const configuredProviderId = config.providerId?.trim() || '';
  const configuredProviderType = config.providerType?.trim() || '';

  if (configuredProviderId) {
    const provider = enabledProviders.find(candidate => candidate.id === configuredProviderId);
    if (!provider) return null;
    if (configuredProviderType && provider.type !== configuredProviderType) {
      return null;
    }

    const models = resolveProviderModels(provider);
    if (!models?.includes(configuredModel)) {
      return null;
    }

    return {
      providerId: provider.id,
      providerType: provider.type,
      model: configuredModel,
    };
  }

  if (configuredProviderType) {
    for (const provider of enabledProviders) {
      if (provider.type !== configuredProviderType) continue;
      const models = resolveProviderModels(provider);
      if (!models?.includes(configuredModel)) {
        continue;
      }

      return {
        providerId: provider.id,
        providerType: provider.type,
        model: configuredModel,
      };
    }

    return null;
  }

  for (const provider of enabledProviders) {
    const models = resolveProviderModels(provider);
    if (!models?.includes(configuredModel)) {
      continue;
    }

    return {
      providerId: provider.id,
      providerType: provider.type,
      model: configuredModel,
    };
  }

  return null;
};

const findConfiguredToolModel = (
  providers: ReturnType<typeof getProviders>,
  config?: ToolModelSelectionInput | null
): ToolModelConfig | null => {
  const enabledProviders = providers.filter(provider => provider.enabled);
  return resolveExplicitToolModel(enabledProviders, config ?? {});
};

/**
 * Get Tool Model configuration with auto-detection.
 * Priority: exact provider selection → legacy provider/model config → auto-detect.
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
        const models = resolveProviderModels(provider);
        if (!models) {
          continue;
        }

        const validModels = models.filter((model: string) => {
          const lower = model.toLowerCase();
          return !lower.includes('o1') && !lower.includes('o3') && !lower.includes('thinking');
        });

        for (const recommended of recommendedModels) {
          if (validModels.includes(recommended)) {
            return {
              providerId: provider.id,
              providerType: provider.type,
              model: recommended,
            };
          }
        }

        if (validModels.length > 0) {
          return {
            providerId: provider.id,
            providerType: provider.type,
            model: validModels[0],
          };
        }
      }
    }

    if (enabledProviders.length > 0) {
      const provider = enabledProviders[0];
      const models = resolveProviderModels(provider);
      if (models && models.length > 0) {
        return {
          providerId: provider.id,
          providerType: provider.type,
          model: models[0],
        };
      }
    }

    return null;
  } catch (error) {
    toolModelLogger.error('Failed to get tool model', error);
    return null;
  }
};

export const testToolModelLatency = async (
  config?: ToolModelSelectionInput | null
): Promise<ToolModelLatencyResult> => {
  const hasExplicitSelection = Boolean(
    config?.providerId?.trim() || config?.providerType?.trim() || config?.model?.trim()
  );
  const resolvedToolModel = hasExplicitSelection
    ? findConfiguredToolModel(getProviders(), config)
    : getToolModel();

  if (!resolvedToolModel) {
    throw new Error(
      hasExplicitSelection ? 'Selected tool model is unavailable.' : 'Tool model is unavailable.'
    );
  }

  const model = createModel(
    resolvedToolModel.providerType,
    resolvedToolModel.model,
    resolvedToolModel.providerId
  );
  const startTime = Date.now();

  await generateText({
    model,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    ...getModelCallSettings(
      resolvedToolModel.providerType,
      resolvedToolModel.model,
      resolvedToolModel.providerId
    ),
    maxOutputTokens: 8,
  });

  return {
    ...(resolvedToolModel.providerId ? { providerId: resolvedToolModel.providerId } : {}),
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
