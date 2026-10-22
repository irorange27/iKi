import { getProviders } from '../db/providers';
import { getAppConfig } from '../config';
import { createLogger } from '@iki/backend/logger';
import { generateConversationTitle } from '../runtimes/title_runtime';
import { generateChatWithModelMessages } from '../provider/llm/factory';
import { parseModelList } from '@iki/backend/utils/provider_models';

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

const resolveFallbackToolModel = (providers: ReturnType<typeof getProviders>): ToolModelConfig | null => {
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const models = resolveProviderModels(provider);
    if (!models || models.length === 0) continue;
    return {
      providerId: provider.id,
      providerType: provider.type,
      model: models[0],
    };
  }
  return null;
};

export const getToolModel = (): ToolModelConfig | null => {
  try {
    const config = getAppConfig();
    const providers = getProviders();

    const configuredToolModel = findConfiguredToolModel(providers, config?.toolModel);
    if (configuredToolModel) {
      return configuredToolModel;
    }

    const fallback = resolveFallbackToolModel(providers);
    if (fallback) {
      toolModelLogger.event({
        level: 'info',
        event: 'tool_model.resolve',
        outcome: 'degraded',
        message:
          'No tool model configured; using the first enabled provider. Auxiliary calls (tool/skill routing, titles, emotion) depend on it.',
        data: {
          providerId: fallback.providerId ?? null,
          providerType: fallback.providerType,
          model: fallback.model,
        },
      });
    }
    return fallback;
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

  const startTime = Date.now();
  await generateChatWithModelMessages({
    providerType: resolvedToolModel.providerType,
    ...(resolvedToolModel.providerId ? { providerId: resolvedToolModel.providerId } : {}),
    modelId: resolvedToolModel.model,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    maxOutputTokens: 8,
  });

  return {
    ...(resolvedToolModel.providerId ? { providerId: resolvedToolModel.providerId } : {}),
    providerType: resolvedToolModel.providerType,
    model: resolvedToolModel.model,
    responseTimeMs: Math.max(Date.now() - startTime, 0),
  };
};

export const generateTitle = async (conversationContent: string): Promise<string | null> =>
  generateConversationTitle(conversationContent, getToolModel);
