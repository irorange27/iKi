import {
  getProviderConfig,
  fetchModelsFromDev,
  generateChat,
  streamChat,
  type ChatTextMessage,
} from './factory';

export const getKimiConfig = () => getProviderConfig('kimi');

// Cache for models
let cachedModels: string[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 3600000; // 1 hour

export const getKimiModels = async () => {
  const now = Date.now();
  if (cachedModels && now - lastFetchTime < CACHE_TTL) return cachedModels;

  const fetched = await fetchModelsFromDev('kimi');
  if (fetched.length > 0) {
    cachedModels = fetched;
    lastFetchTime = now;
    return cachedModels;
  }

  try {
    return getKimiConfig().models;
  } catch {
    return [];
  }
};

export const generateKimiChat = async (modelId: string, messages: ChatTextMessage[]) => {
  return generateChat({ providerType: 'kimi', modelId, messages });
};

export const streamKimiText = async (
  modelId: string,
  messages: ChatTextMessage[],
  onChunk: (chunk: string) => void
) => {
  return streamChat({ providerType: 'kimi', modelId, messages }, onChunk);
};

export default {
  getKimiConfig,
  generateKimiChat,
  streamKimiText,
  getKimiModels,
};
