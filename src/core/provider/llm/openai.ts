import {
  getProviderConfig,
  fetchModelsFromDev,
  generateChat,
  streamChat,
  type ChatTextMessage,
} from './factory';

export const getOpenAIConfig = () => getProviderConfig('openai');

// Cache for models
let cachedModels: string[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 3600000; // 1 hour

export const getOpenAIModels = async () => {
  const now = Date.now();
  if (cachedModels && now - lastFetchTime < CACHE_TTL) return cachedModels;

  const fetched = await fetchModelsFromDev('openai');
  if (fetched.length > 0) {
    cachedModels = fetched;
    lastFetchTime = now;
    return cachedModels;
  }

  try {
    return getOpenAIConfig().models;
  } catch {
    return [];
  }
};

export const generateOpenAIChat = async (modelId: string, messages: ChatTextMessage[]) => {
  return generateChat({ providerType: 'openai', modelId, messages });
};

export const streamOpenAIText = async (
  modelId: string,
  messages: ChatTextMessage[],
  onChunk: (chunk: string) => void
) => {
  return streamChat({ providerType: 'openai', modelId, messages }, onChunk);
};

export default {
  getOpenAIConfig,
  generateOpenAIChat,
  streamOpenAIText,
  getOpenAIModels,
};
