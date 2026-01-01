import { generateText, streamText, LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getProviders } from '../../db/providers';

export interface ProviderConfig {
  id: string;
  type: string;
  apiKey: string;
  baseURL: string;
  models: string[];
}

export const getProviderConfig = (providerType: string): ProviderConfig => {
  const providers = getProviders();
  const provider = providers.find(p => p.type === providerType && p.enabled);

  if (!provider) {
    throw new Error(`Provider ${providerType} not configured or not enabled`);
  }

  let models: string[] = [];
  try {
    models = JSON.parse(provider.models || '[]');
  } catch (e) {
    console.error(`Failed to parse models for ${providerType}:`, e);
  }

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

export const streamChat = async (
  options: {
    providerType: string;
    modelId: string;
    messages: any[];
  },
  onChunk: (chunk: string) => void
) => {
  const model = createModel(options.providerType, options.modelId);

  const result = streamText({
    model,
    messages: options.messages,
  });

  let fullText = '';
  for await (const textPart of result.textStream) {
    fullText += textPart;
    onChunk(textPart);
  }
  return fullText;
};

export const generateChat = async (options: {
  providerType: string;
  modelId: string;
  messages: any[];
}) => {
  const model = createModel(options.providerType, options.modelId);

  const { text } = await generateText({
    model,
    messages: options.messages,
  });

  return text;
};

export const fetchModelsFromDev = async (providerType: string) => {
  console.log(`[Factory] Fetching latest models for ${providerType} from models.dev...`);
  try {
    const response = await fetch('https://models.dev/api.json');
    if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

    const data: any = await response.json();

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
