import * as llmFactory from '../provider/llm/factory';
import { getProviderModels, getProviderModelsForRecord } from '../provider/llm/model_discovery';
import { createLogger } from '@iki/backend/logger';
import type {
  ProviderModelDescriptor,
  ProviderModelDiscoveryOverride,
} from '@iki/backend/types/provider';
import { ensureModelCapability } from '@iki/backend/utils/provider_models';

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
      // A named provider row (or an unsaved draft carrying one) gets live
      // discovery: the endpoint's own /models is the only source that can know
      // about a private gateway's models. Anonymous/static types keep the
      // catalog path.
      const overrideBaseUrl = providerOverride?.base_url?.trim();
      const overrideApiKey = providerOverride?.api_key?.trim();
      const shouldUseRecord =
        Boolean(providerId) || Boolean(overrideBaseUrl) || Boolean(overrideApiKey);

      const modelIds = shouldUseRecord
        ? await getProviderModelsForRecord({
            providerId: providerId ?? providerOverride?.id ?? providerType,
            providerType,
            ...(overrideBaseUrl || providerOverride?.base_url
              ? { baseUrl: overrideBaseUrl || providerOverride?.base_url || '' }
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

export type ChatStreamingModels = ReturnType<typeof createChatStreamingModels>;
