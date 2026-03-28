import { generateText, streamText, type LanguageModel, type ModelMessage } from 'ai';
import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getProviders } from '../../db/providers';
import { createLogger } from '../../logger';
import { getPersonaPrompt } from '../../persona';
import { fetchWithTimeout } from '../../network/http';
import {
  getProviderModelOptions,
  listModelsDevProviderModels,
  lookupModelsDevModelCapability,
  mergeModelCapability,
  parseModelList,
  parseProviderModelOptionsMap,
  type ModelCapability,
  type ModelsDevCatalog,
} from '../../../shared/utils/provider_models';
import type { ProviderModelOptions, ProviderModelOptionsMap } from '../../../shared/types/provider';
import type { TokenUsageMetrics } from '../../../shared/types/chat_usage';
import { normalizeLanguageModelUsage } from './usage';

const factoryLogger = createLogger({ module: 'llm_factory' });
const MODELS_DEV_CACHE_TTL_MS = 3600000;
const MODELS_DEV_TIMEOUT_MS = 1200;

let cachedModelsDevCatalog: ModelsDevCatalog | null = null;
let cachedModelsDevFetchedAt = 0;

export interface ProviderConfig {
  id: string;
  type: string;
  apiKey: string;
  baseURL: string;
  models: string[];
  modelOptions: ProviderModelOptionsMap;
  isResponseApi: boolean;
}

export interface ChatGenerationResult {
  text: string;
  usage: TokenUsageMetrics;
}

export type StreamChatResult = ChatGenerationResult;

export type ChatTextMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isLanguageModelInstance = (value: unknown): value is LanguageModel => {
  if (typeof value === 'string') return true;
  if (!isObjectRecord(value)) return false;

  return (
    value.specificationVersion === 'v3' &&
    typeof value.provider === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.doGenerate === 'function' &&
    typeof value.doStream === 'function' &&
    'supportedUrls' in value
  );
};

const toModelMessages = (messages: ChatTextMessage[]): ModelMessage[] => {
  return messages.map(message => ({
    role: message.role,
    content: message.content,
  }));
};

export const getProviderConfig = (providerType: string, providerId?: string | null): ProviderConfig => {
  const providers = getProviders();
  const normalizedProviderId =
    typeof providerId === 'string' && providerId.trim().length > 0 ? providerId.trim() : '';
  const provider = normalizedProviderId
    ? providers.find(p => p.id === normalizedProviderId && p.enabled)
    : providers.find(p => p.type === providerType && p.enabled);

  if (!provider) {
    if (normalizedProviderId) {
      throw new Error(`Provider ${normalizedProviderId} is not configured or not enabled`);
    }
    throw new Error(`Provider ${providerType} not configured or not enabled`);
  }

  if (providerType && provider.type !== providerType) {
    throw new Error(
      `Provider ${provider.id} is type "${provider.type}", not the requested "${providerType}".`
    );
  }

  const models = parseModelList(provider.models);

  return {
    id: provider.id,
    type: provider.type,
    apiKey: provider.api_key,
    baseURL: provider.base_url || '',
    models,
    modelOptions: parseProviderModelOptionsMap(provider.model_options),
    isResponseApi: provider.is_response_api === true,
  };
};

const getStoredProviderModelOptions = (
  providerType: string,
  modelId: string,
  providerId?: string | null
) => {
  try {
    const config = getProviderConfig(providerType, providerId);
    return getProviderModelOptions(config.modelOptions, modelId);
  } catch {
    return null;
  }
};

const getStoredProviderModelContext = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): { config: ProviderConfig; modelOptions: ProviderModelOptions | null } | null => {
  try {
    const config = getProviderConfig(providerType, providerId);
    return {
      config,
      modelOptions: getProviderModelOptions(config.modelOptions, modelId),
    };
  } catch {
    return null;
  }
};

const normalizeOptionalLowercaseString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

// Mirror the OpenAI SDK 3.0.2 reasoning-model capability contract so our call assembly stays
// aligned with the provider's own parameter-compatibility rules for OpenAI-backed runtimes.
const isOpenAIReasoningModelBySdkContract = (modelId: string): boolean => {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return false;

  return (
    normalizedModelId.startsWith('o1') ||
    normalizedModelId.startsWith('o3') ||
    normalizedModelId.startsWith('o4-mini') ||
    normalizedModelId.startsWith('codex-mini') ||
    normalizedModelId.startsWith('computer-use-preview') ||
    (normalizedModelId.startsWith('gpt-5') && !normalizedModelId.startsWith('gpt-5-chat'))
  );
};

const openAIModelSupportsNonReasoningParameters = (modelId: string): boolean => {
  const normalizedModelId = modelId.trim().toLowerCase();
  return normalizedModelId.startsWith('gpt-5.1') || normalizedModelId.startsWith('gpt-5.2');
};

const shouldOmitTemperatureForModelCall = (params: {
  providerType: string;
  modelId: string;
  providerId?: string | null;
  temperature?: number;
}): boolean => {
  if (typeof params.temperature !== 'number') return false;

  const storedContext = getStoredProviderModelContext(
    params.providerType,
    params.modelId,
    params.providerId
  );
  const usesOpenAISdkCompatibilityRules =
    params.providerType === 'openai' || storedContext?.config.isResponseApi === true;

  if (!usesOpenAISdkCompatibilityRules) {
    return false;
  }

  const providerOptions = storedContext?.modelOptions?.providerOptions;
  const reasoningEffort = normalizeOptionalLowercaseString(providerOptions?.reasoningEffort);
  const isReasoningModel =
    providerOptions?.forceReasoning === true ||
    storedContext?.modelOptions?.supportsReasoning === true ||
    isOpenAIReasoningModelBySdkContract(params.modelId);

  if (!isReasoningModel) {
    return false;
  }

  return !(
    reasoningEffort === 'none' && openAIModelSupportsNonReasoningParameters(params.modelId)
  );
};

export const getModelCallSettings = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): { providerOptions?: SharedV3ProviderOptions } => {
  const modelOptions = getStoredProviderModelOptions(providerType, modelId, providerId);
  const providerOptions = modelOptions?.providerOptions;
  if (!providerOptions || Object.keys(providerOptions).length === 0) {
    return {};
  }

  return {
    providerOptions: {
      [providerType]: providerOptions,
    },
  };
};

export const getModelGenerationSettings = (params: {
  providerType: string;
  modelId: string;
  providerId?: string | null;
  temperature?: number;
}): { providerOptions?: SharedV3ProviderOptions; temperature?: number } => {
  const callSettings = getModelCallSettings(params.providerType, params.modelId, params.providerId);

  if (shouldOmitTemperatureForModelCall(params)) {
    return callSettings;
  }

  return typeof params.temperature === 'number'
    ? {
        ...callSettings,
        temperature: params.temperature,
      }
    : callSettings;
};

export const createModel = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): LanguageModel => {
  const config = getProviderConfig(providerType, providerId);

  // Validations: If no modelId, try to pick the first one from config
  if (!modelId && config.models.length > 0) {
    modelId = config.models[0];
  }

  if (!modelId) {
    throw new Error(
      `Model not specified for provider "${providerType}". Please select a model in chat or update settings.`
    );
  }

  const storedModelOptions = getProviderModelOptions(config.modelOptions, modelId);

  if (providerType === 'openai') {
    const client = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.openai.com/v1',
    });
    return client(modelId);
  }
  if (providerType === 'anthropic' || providerType === 'anthropic-compatible') {
    const client = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.anthropic.com/v1',
      ...(providerType === 'anthropic-compatible' ? { name: providerType } : {}),
    });
    const model = client(modelId);
    if (!isLanguageModelInstance(model)) {
      throw new Error(`Anthropic provider returned an invalid language model for "${modelId}".`);
    }
    return model;
  }
  if (providerType === 'deepseek') {
    const client = createDeepSeek({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
    });
    return client(modelId);
  }

  if (config.isResponseApi) {
    const client = createOpenAI({
      name: providerType,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    return client.responses(modelId);
  }

  // Default to OpenAI compatible for most other providers
  const client = createOpenAICompatible({
    name: providerType,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  if (typeof storedModelOptions?.supportsStructuredOutputs === 'boolean') {
    return client.languageModel(modelId, {
      supportsStructuredOutputs: storedModelOptions.supportsStructuredOutputs,
    });
  }

  return client(modelId);
};

export const getFullSystemPrompt = (providerType: string, providerId?: string | null) => {
  getProviderConfig(providerType, providerId);
  const personaPrompt = getPersonaPrompt();
  return personaPrompt;
};

export const streamChat = async (
  options: {
    providerType: string;
    providerId?: string;
    modelId: string;
    messages: ChatTextMessage[];
    extraSystemPrompt?: string;
    maxOutputTokens?: number;
  },
  onChunk: (chunk: string) => void,
  shouldCancel?: () => boolean,
  abortSignal?: AbortSignal
) => {
  const result = await streamChatWithUsage(options, onChunk, shouldCancel, abortSignal);
  return result.text;
};

export const streamChatWithUsage = async (
  options: {
    providerType: string;
    providerId?: string;
    modelId: string;
    messages: ChatTextMessage[];
    extraSystemPrompt?: string;
    maxOutputTokens?: number;
  },
  onChunk: (chunk: string) => void,
  shouldCancel?: () => boolean,
  abortSignal?: AbortSignal
) => {
  const model = createModel(options.providerType, options.modelId, options.providerId);
  const systemPrompt = [
    getFullSystemPrompt(options.providerType, options.providerId),
    options.extraSystemPrompt,
  ]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');

  const result = streamText({
    model,
    system: systemPrompt,
    messages: toModelMessages(options.messages),
    ...getModelCallSettings(options.providerType, options.modelId, options.providerId),
    ...(typeof options.maxOutputTokens === 'number'
      ? { maxOutputTokens: options.maxOutputTokens }
      : {}),
    abortSignal,
  });

  let fullText = '';
  for await (const part of result.fullStream) {
    if (shouldCancel?.()) {
      break;
    }
    if (part.type !== 'text-delta' || !part.text) {
      continue;
    }
    fullText += part.text;
    onChunk(part.text);
  }

  if (!fullText) {
    const streamedText = await Promise.resolve(result.text);
    if (streamedText) {
      fullText = streamedText;
    }
  }

  return {
    text: fullText,
    usage: normalizeLanguageModelUsage(await Promise.resolve(result.totalUsage ?? result.usage)),
  };
};

export const generateChat = async (options: {
  providerType: string;
  providerId?: string;
  modelId: string;
  messages: ChatTextMessage[];
  extraSystemPrompt?: string;
  maxOutputTokens?: number;
}) => {
  const result = await generateChatWithUsage(options);
  return result.text;
};

export const generateChatWithUsage = async (options: {
  providerType: string;
  providerId?: string;
  modelId: string;
  messages: ChatTextMessage[];
  extraSystemPrompt?: string;
  maxOutputTokens?: number;
}): Promise<ChatGenerationResult> => {
  const model = createModel(options.providerType, options.modelId, options.providerId);
  const systemPrompt = [
    getFullSystemPrompt(options.providerType, options.providerId),
    options.extraSystemPrompt,
  ]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: toModelMessages(options.messages),
    ...getModelCallSettings(options.providerType, options.modelId, options.providerId),
    ...(typeof options.maxOutputTokens === 'number'
      ? { maxOutputTokens: options.maxOutputTokens }
      : {}),
  });

  return {
    text: result.text,
    usage: normalizeLanguageModelUsage(result.totalUsage || result.usage),
  };
};

export const fetchModelsFromDev = async (providerType: string) => {
  try {
    const data = await fetchModelsDevCatalog();
    return listModelsDevProviderModels(data, providerType);
  } catch (error) {
    factoryLogger.error(`Failed to fetch models for ${providerType}`, error);
  }
  return [];
};

const fetchModelsDevCatalog = async (): Promise<ModelsDevCatalog> => {
  const now = Date.now();
  if (cachedModelsDevCatalog && now - cachedModelsDevFetchedAt < MODELS_DEV_CACHE_TTL_MS) {
    return cachedModelsDevCatalog;
  }

  const response = await fetchWithTimeout(
    'https://models.dev/api.json',
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    },
    { timeoutMs: MODELS_DEV_TIMEOUT_MS, retries: 0 }
  );
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ModelsDevCatalog;
  cachedModelsDevCatalog = data;
  cachedModelsDevFetchedAt = now;
  return data;
};

export const fetchModelCapabilityFromDev = async (
  providerType: string,
  modelId: string
): Promise<ModelCapability | null> => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  try {
    const catalog = await fetchModelsDevCatalog();
    return lookupModelsDevModelCapability(catalog, providerType, trimmedModelId);
  } catch (error) {
    factoryLogger.error(
      `Failed to fetch model capability for ${providerType}/${trimmedModelId}`,
      error
    );
    return null;
  }
};

export const resolveModelCapability = async (
  providerType: string,
  modelId: string,
  providerId?: string | null
): Promise<ModelCapability | null> => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  const modelOptions = getStoredProviderModelOptions(providerType, trimmedModelId, providerId);
  const baseCapability = await fetchModelCapabilityFromDev(providerType, trimmedModelId);

  return mergeModelCapability(baseCapability, providerType, trimmedModelId, modelOptions);
};
