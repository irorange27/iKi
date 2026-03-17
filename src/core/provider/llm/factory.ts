import { generateText, streamText, type LanguageModel, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getProviders } from '../../db/providers';
import { getPersonaPrompt } from '../../persona';
import { fetchWithTimeout } from '../../network/http';
import { parseModelList } from '../../../shared/utils/provider_models';

export interface ProviderConfig {
  id: string;
  type: string;
  apiKey: string;
  baseURL: string;
  models: string[];
}

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
  },
  onChunk: (chunk: string) => void,
  shouldCancel?: () => boolean,
  abortSignal?: AbortSignal
) => {
  const debugId = `${options.providerType}:${options.modelId}:${Date.now()}`;
  const model = createModel(options.providerType, options.modelId);
  const systemPrompt = [getFullSystemPrompt(options.providerType), options.extraSystemPrompt]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');

  const result = streamText({
    model,
    system: systemPrompt,
    messages: toModelMessages(options.messages),
    abortSignal,
  });

  let fullText = '';
  let partCount = 0;
  let textDeltaCount = 0;
  const startedAt = Date.now();
  console.log(
    `[StreamDebug][Factory][${debugId}] start messageCount=${options.messages.length}`
  );
  for await (const part of result.fullStream) {
    partCount += 1;
    if (part.type !== 'text-delta' || !part.text) {
      if (partCount <= 5) {
        console.log(`[StreamDebug][Factory][${debugId}] part#${partCount} type=${part.type}`);
      }
      continue;
    }

    if (shouldCancel?.()) {
      console.log(
        `[StreamDebug][Factory][${debugId}] cancel-before-onChunk partCount=${partCount} textDeltaCount=${textDeltaCount} fullTextLen=${fullText.length}`
      );
      break;
    }
    textDeltaCount += 1;
    if (textDeltaCount <= 3 || textDeltaCount % 20 === 0) {
      console.log(
        `[StreamDebug][Factory][${debugId}] text-delta#${textDeltaCount} len=${part.text.length} fullTextLen=${fullText.length + part.text.length}`
      );
    }
    fullText += part.text;
    onChunk(part.text);
  }
  console.log(
    `[StreamDebug][Factory][${debugId}] done partCount=${partCount} textDeltaCount=${textDeltaCount} fullTextLen=${fullText.length} durationMs=${Date.now() - startedAt}`
  );
  return fullText;
};

export const generateChat = async (options: {
  providerType: string;
  modelId: string;
  messages: ChatTextMessage[];
  extraSystemPrompt?: string;
}) => {
  const model = createModel(options.providerType, options.modelId);
  const systemPrompt = [getFullSystemPrompt(options.providerType), options.extraSystemPrompt]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');

  const { text } = await generateText({
    model,
    system: systemPrompt,
    messages: toModelMessages(options.messages),
  });

  return text;
};

export const fetchModelsFromDev = async (providerType: string) => {
  console.log(`[Factory] Fetching latest models for ${providerType} from models.dev...`);
  try {
    const response = await fetchWithTimeout('https://models.dev/api.json');
    if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

    const data = (await response.json()) as Record<string, { models?: Record<string, unknown> }>;

    const mapping: Record<string, string> = {
      kimi: 'moonshotai',
      moonshot: 'moonshotai',
      zhipu: 'zhipuai',
      minimax: 'minimax-cn',
      deepseek: 'deepseek',
      openai: 'openai',
    };

    const key = mapping[providerType] || providerType;
    const providerData = data[key];

    if (providerData && providerData.models) {
      return Object.keys(providerData.models);
    }
  } catch (error) {
    console.error(`[Factory] Failed to fetch models for ${providerType}:`, error);
  }
  return [];
};
