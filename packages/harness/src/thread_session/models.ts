import * as llmFactory from '@iki/llm-pi-ai/factory';
import { getProviderModels, getProviderModelsForRecord } from '@iki/llm-pi-ai/model_discovery';
import { createLogger } from '@iki/core/logger';
import type {
  ProviderModelDescriptor,
  ProviderModelDiscoveryOverride,
} from '@iki/core/types/provider';
import { ensureModelCapability } from '@iki/core/utils/provider_models';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

export const createChatStreamingModels = () => {
  const toDescriptors = async (
    providerType: string,
    providerId: string | undefined,
    modelIds: string[]
  ) => {
    const normalizedIds = modelIds
      .filter((modelId): modelId is string => typeof modelId === 'string')
      .map(modelId => modelId.trim())
      .filter(Boolean)
      .filter((modelId, index, list) => list.indexOf(modelId) === index);

    return await Promise.all(
      normalizedIds.map(async modelId => {
        const resolvedCapability = await llmFactory.resolveModelCapability(
          providerType,
          modelId,
          providerId
        );
        const capability = ensureModelCapability(providerType, modelId, resolvedCapability);

        return {
          id: modelId,
          displayName: capability?.displayName || modelId,
          contextWindow: capability.contextWindow,
          maxInputTokens: capability.maxInputTokens,
          maxOutputTokens: capability?.maxOutputTokens ?? null,
          ...(capability?.supportsToolCalls !== null &&
          capability?.supportsToolCalls !== undefined
            ? { supportsToolCalls: capability.supportsToolCalls }
            : {}),
          ...(capability?.supportsReasoning !== null &&
          capability?.supportsReasoning !== undefined
            ? { supportsReasoning: capability.supportsReasoning }
            : {}),
          ...(capability?.supportsVision !== null && capability?.supportsVision !== undefined
            ? { supportsVision: capability.supportsVision }
            : {}),
          ...(capability.source !== 'default' ? { source: capability.source } : {}),
        } satisfies ProviderModelDescriptor;
      })
    );
  };

  const getModels = async (
    providerType: string,
    providerId?: string,
    providerOverride?: ProviderModelDiscoveryOverride | null
  ): Promise<ProviderModelDescriptor[]> => {
    try {

      const overrideBaseUrl = providerOverride?.baseUrl?.trim();
      const overrideApiKey = providerOverride?.apiKey?.trim();
      const shouldUseRecord =
        Boolean(providerId) || Boolean(overrideBaseUrl) || Boolean(overrideApiKey);

      const modelIds = shouldUseRecord
        ? await getProviderModelsForRecord({
            providerId: providerId ?? providerOverride?.id ?? providerType,
            providerType,
            ...(overrideBaseUrl || providerOverride?.baseUrl
              ? { baseUrl: overrideBaseUrl || providerOverride?.baseUrl || '' }
              : {}),
            ...(overrideApiKey ? { apiKey: overrideApiKey } : {}),
          })
        : await getProviderModels(providerType);

      return await toDescriptors(providerType, providerId, modelIds);
    } catch (error: unknown) {
      chatStreamingLogger.error(`Failed to get models for ${providerType}`, error);
      return [];
    }
  };

  const isProviderConfigured = (providerType: string, providerId?: string) => {
    try {
      const config = llmFactory.getProviderConfig(providerType, providerId);
      return Boolean(config.apiKey);
    } catch {
      return false;
    }
  };

  return { getModels, isProviderConfigured };
};
