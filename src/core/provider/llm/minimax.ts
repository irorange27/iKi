import {
  getProviderConfig,
  fetchModelsFromDev,
  generateChat,
  streamChat,
  type ChatTextMessage,
} from './factory';

export const getMinimaxConfig = () => getProviderConfig('minimax');

let cachedModels: string[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 3600000;

export const getMinimaxModels = async () => {
  const now = Date.now();
  if (cachedModels && now - lastFetchTime < CACHE_TTL) return cachedModels;

  const fetched = await fetchModelsFromDev('minimax');
  if (fetched.length > 0) {
    cachedModels = fetched;
    lastFetchTime = now;
    return cachedModels;
  }

  try {
    return getMinimaxConfig().models;
  } catch {
    return [];
  }
};

export const generateMinimaxChat = async (modelId: string, messages: ChatTextMessage[]) => {
  return generateChat({ providerType: 'minimax', modelId, messages });
};

export const streamMinimaxText = async (
  modelId: string,
  messages: ChatTextMessage[],
  onChunk: (chunk: string) => void
) => {
  return streamChat({ providerType: 'minimax', modelId, messages }, onChunk);
};

export default {
  getMinimaxConfig,
  generateMinimaxChat,
  streamMinimaxText,
  getMinimaxModels,
};
