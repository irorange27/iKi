import {
  getProviderConfig,
  fetchModelsFromDev,
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

export default {
  getMinimaxConfig,
  getMinimaxModels,
};
