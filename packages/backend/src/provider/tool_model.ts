import { generateText } from 'ai';

import { getProviders } from '@iki/core/context/provider_store';
import { getAppConfig } from '@iki/core/context/config_provider';
import { createLogger } from '@iki/core/logger';
import { LlmTitleRuntime, type TitleRuntime } from '../runtimes/title_runtime';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';
import { createModel, disposeLanguageModel, getModelCallSettings } from '@iki/core/provider/llm/factory';
import { parseModelList } from '@iki/core/utils/provider_models';

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

// Resolves the first available model from enabled providers as a fallback for
// lightweight tasks (title generation, etc.) when no explicit tool model is configured.
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

    return resolveFallbackToolModel(providers);
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
  try {
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
  } finally {
    disposeLanguageModel(model);
  }

  return {
    ...(resolvedToolModel.providerId ? { providerId: resolvedToolModel.providerId } : {}),
    providerType: resolvedToolModel.providerType,
    model: resolvedToolModel.model,
    responseTimeMs: Math.max(Date.now() - startTime, 0),
  };
};

export type { TitleRuntime };
export { LlmTitleRuntime };

export const generateTitle = async (conversationContent: string): Promise<string | null> => {
  const trimmed = conversationContent.trim();
  if (!trimmed) return null;

  const runtime = new LlmTitleRuntime({
    getToolModel,
    createGenerator: createSimplePromptTextGenerator,
  });
  return runtime.run(trimmed);
};

export const generateTitleWithAgent = generateTitle;
