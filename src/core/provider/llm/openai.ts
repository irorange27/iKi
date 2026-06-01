import {
  getProviderConfig,
  fetchModelsFromDev,
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

export default {
  getOpenAIConfig,
  getOpenAIModels,
};
