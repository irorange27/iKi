import { fetchModelsFromDev, getProviderConfig } from './factory';

const CACHE_TTL_MS = 3600000;

const caches = new Map<string, { models: string[]; fetchedAt: number }>();

/**
 * Model discovery for static provider types: models.dev catalog first, then the
 * provider's own configured model list. One cache slot per provider type.
 */
export const getProviderModels = async (providerType: string): Promise<string[]> => {
  const now = Date.now();
  const cached = caches.get(providerType);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.models;

  const fetched = await fetchModelsFromDev(providerType);
  if (fetched.length > 0) {
    caches.set(providerType, { models: fetched, fetchedAt: now });
    return fetched;
  }

  try {
    return getProviderConfig(providerType).models;
  } catch {
    return [];
  }
};
