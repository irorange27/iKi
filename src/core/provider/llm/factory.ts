import { generateText, streamText, type LanguageModel, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getProviders } from '../../db/providers';
import { createLogger } from '../../logger';
import { getPersonaPrompt } from '../../persona';
import { fetchWithTimeout } from '../../network/http';
import {
  listModelsDevProviderModels,
  lookupModelsDevModelCapability,
  parseModelList,
  type ModelCapability,
  type ModelsDevCatalog,
} from '../../../shared/utils/provider_models';
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

const toModelMessages = (messages: ChatTextMessage[]): ModelMessage[] => {
  return messages.map(message => ({
    role: message.role,
    content: message.content,
  }));
};

export const getProviderConfig = (providerType: string): ProviderConfig => {
  const providers = getProviders();
  const provider = providers.find(p => p.type === providerType && p.enabled);

  if (!provider) {
    throw new Error(`Provider ${providerType} not configured or not enabled`);
  }

  const models = parseModelList(provider.models);

  return {
    id: provider.id,
    type: provider.type,
    apiKey: provider.api_key,
    baseURL: provider.base_url || '',
    models,
  };
};

export const createModel = (providerType: string, modelId: string): LanguageModel => {
  const config = getProviderConfig(providerType);

  // Validations: If no modelId, try to pick the first one from config
  if (!modelId && config.models.length > 0) {
    modelId = config.models[0];
  }

  if (!modelId) {
    throw new Error(
      `Model not specified for provider "${providerType}". Please select a model in chat or update settings.`
    );
  }

  if (providerType === 'openai') {
    const client = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.openai.com/v1',
    });
    return client(modelId);
  }
  if (providerType === 'deepseek') {
    const client = createDeepSeek({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
    });
    return client(modelId);
  }

  // Default to OpenAI compatible for most other providers
  const client = createOpenAICompatible({
    name: providerType,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return client(modelId);
};

export const getFullSystemPrompt = (providerType: string) => {
  getProviderConfig(providerType);
  const personaPrompt = getPersonaPrompt();
  return personaPrompt;
};

export const streamChat = async (
  options: {
    providerType: string;
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
    modelId: string;
    messages: ChatTextMessage[];
    extraSystemPrompt?: string;
    maxOutputTokens?: number;
  },
  onChunk: (chunk: string) => void,
  shouldCancel?: () => boolean,
  abortSignal?: AbortSignal
) => {
  const model = createModel(options.providerType, options.modelId);
  const systemPrompt = [getFullSystemPrompt(options.providerType), options.extraSystemPrompt]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');

  const result = streamText({
    model,
    system: systemPrompt,
    messages: toModelMessages(options.messages),
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
  modelId: string;
  messages: ChatTextMessage[];
  extraSystemPrompt?: string;
  maxOutputTokens?: number;
}): Promise<ChatGenerationResult> => {
  const model = createModel(options.providerType, options.modelId);
  const systemPrompt = [getFullSystemPrompt(options.providerType), options.extraSystemPrompt]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: toModelMessages(options.messages),
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
