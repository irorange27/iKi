import * as llmFactory from '../provider/llm/factory';
import * as deepseekProvider from '../provider/llm/deepseek';
import * as kimiProvider from '../provider/llm/kimi';
import * as minimaxProvider from '../provider/llm/minimax';
import * as openaiProvider from '../provider/llm/openai';
import { createLogger } from '@iki/backend/logger';
import { ACP_PROVIDER_TYPE } from '@iki/backend/constants/acp';
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
      if (providerType === ACP_PROVIDER_TYPE) {
        const acpDescriptors = await llmFactory.fetchAcpModels(
          providerType,
          providerId,
          providerOverride ?? undefined
        );
        return await Promise.all(
          acpDescriptors.map(async descriptor => {
            const resolvedCapability = await llmFactory.resolveModelCapability(
              providerType,
              descriptor.id,
              providerId
            );
            const capability = ensureModelCapability(providerType, descriptor.id, resolvedCapability, {
              contextWindow: descriptor.contextWindow ?? null,
              maxInputTokens: descriptor.maxInputTokens ?? null,
              maxOutputTokens: descriptor.maxOutputTokens ?? null,
            });
            const descriptorSource =
              capability.source !== 'default'
                ? capability.source
                : descriptor.source;
            const displayName =
              capability.source === 'default'
                ? descriptor.displayName || descriptor.id
                : capability.displayName || descriptor.displayName || descriptor.id;

            return {
              ...descriptor,
              displayName,
              contextWindow: capability.contextWindow,
              maxInputTokens: capability.maxInputTokens,
              maxOutputTokens: capability.maxOutputTokens ?? null,
              supportsToolCalls:
                capability.supportsToolCalls ?? descriptor.supportsToolCalls ?? true,
              ...(capability.supportsReasoning !== null && capability.supportsReasoning !== undefined
                ? { supportsReasoning: capability.supportsReasoning }
                : descriptor.supportsReasoning !== undefined
                  ? { supportsReasoning: descriptor.supportsReasoning }
                  : {}),
              ...(capability.supportsVision !== null && capability.supportsVision !== undefined
                ? { supportsVision: capability.supportsVision }
                : descriptor.supportsVision !== undefined
                  ? { supportsVision: descriptor.supportsVision }
                  : {}),
              ...(descriptorSource ? { source: descriptorSource } : {}),
            } satisfies ProviderModelDescriptor;
          })
        );
      }

      if (providerType === 'deepseek') {
        return await toDescriptors(providerType, providerId, await deepseekProvider.getDeepSeekModels());
      }
      if (providerType === 'openai') {
        return await toDescriptors(providerType, providerId, await openaiProvider.getOpenAIModels());
      }
      if (providerType === 'kimi') {
        return await toDescriptors(providerType, providerId, await kimiProvider.getKimiModels());
      }
      if (providerType === 'minimax') {
        return await toDescriptors(providerType, providerId, await minimaxProvider.getMinimaxModels());
      }

      return await toDescriptors(
        providerType,
        providerId,
        await llmFactory.fetchModelsFromDev(providerType)
      );
    } catch (error: unknown) {
      chatStreamingLogger.error(`Failed to get models for ${providerType}`, error);
      return [];
    }
  };

  const getAcpAuthMethods = async (
    providerType: string,
    providerId?: string,
    providerOverride?: ProviderModelDiscoveryOverride | null
  ) => {
    try {
      return await llmFactory.fetchAcpAuthMethods(
        providerType,
        providerId,
        providerOverride ?? undefined
      );
    } catch (error: unknown) {
      chatStreamingLogger.error('Failed to get ACP auth methods', error);
      return [];
    }
  };

  const isProviderConfigured = (providerType: string, providerId?: string) => {
    try {
      const config = llmFactory.getProviderConfig(providerType, providerId);
      if (providerType.trim().toLowerCase() === ACP_PROVIDER_TYPE) {
        return config.acpCommand.trim().length > 0;
      }
      return Boolean(config.apiKey);
    } catch {
      return false;
    }
  };

  return { getModels, getAcpAuthMethods, isProviderConfigured };
};

export type ChatStreamingModels = ReturnType<typeof createChatStreamingModels>;
