import { fetchModelsFromDev, getProviderConfig } from './factory';
import { fetchWithTimeout } from '@iki/llm/network/http';
import { createLogger } from '@iki/core/logger';

const modelDiscoveryLogger = createLogger({ module: 'llm_model_discovery' });

const CACHE_TTL_MS = 3600000;
const LIVE_MODEL_LIST_TIMEOUT_MS = 8000;

const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
};

const buildModelListUrls = (baseUrl: string, providerType?: string): string[] => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return [];

  if (/localhost|127\.0\.0\.1/.test(trimmed) && /:11434$/.test(trimmed)) {
    return [`${trimmed}/api/tags`, `${trimmed}/v1/models`];
  }

  if (providerType === 'google') {
    return [/\/v\d+(?:beta\d*)?$/i.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1beta/models`];
  }

  if (/\/v\d+(?:beta\d*)?$/i.test(trimmed)) {
    return [`${trimmed}/models`];
  }

  return [`${trimmed}/v1/models`, `${trimmed}/models`];
};

const normalizeDiscoveredModelId = (id: string, providerType?: string): string => {
  const trimmed = id.trim();
  if (providerType === 'google' && trimmed.startsWith('models/')) {
    return trimmed.slice('models/'.length);
  }
  return trimmed;
};

const extractModelIds = (payload: unknown, providerType?: string): string[] => {
  const readId = (entry: unknown): string | null => {
    if (typeof entry === 'string') {
      const trimmed = normalizeDiscoveredModelId(entry, providerType);
      return trimmed.length > 0 ? trimmed : null;
    }
    if (!entry || typeof entry !== 'object') return null;

    const record = entry as Record<string, unknown>;
    for (const key of ['id', 'name', 'model']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return normalizeDiscoveredModelId(value, providerType);
      }
    }
    return null;
  };

  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    const ids = (payload as { data: unknown[] }).data
      .map(readId)
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) return ids;
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { models?: unknown }).models)) {
    const ids = (payload as { models: unknown[] }).models
      .map(readId)
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) return ids;
  }

  if (Array.isArray(payload)) {
    return payload.map(readId).filter((id): id is string => Boolean(id));
  }

  return [];
};

const buildDiscoveryHeaders = (
  providerType?: string,
  apiKey?: string
): Record<string, string> => {
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = apiKey?.trim();
  if (!key) return headers;

  if (providerType === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    return headers;
  }
  if (providerType === 'google') {
    headers['x-goog-api-key'] = key;
    return headers;
  }
  headers.authorization = `Bearer ${key}`;
  return headers;
};

export const fetchLiveProviderModels = async (params: {
  baseUrl: string;
  apiKey?: string;
  providerType?: string;
}): Promise<string[]> => {
  const urls = buildModelListUrls(params.baseUrl, params.providerType);
  if (urls.length === 0) return [];

  const headers = buildDiscoveryHeaders(params.providerType, params.apiKey);

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(
        url,
        { method: 'GET', headers },
        { timeoutMs: LIVE_MODEL_LIST_TIMEOUT_MS, retries: 0 }
      );

      if (!response.ok) continue;

      const modelIds = extractModelIds(await response.json(), params.providerType);
      if (modelIds.length > 0) return modelIds;
    } catch (error) {
      modelDiscoveryLogger.event({
        level: 'warn',
        event: 'llm.models.live.fetch',
        outcome: 'failed',
        error,
        entity: { url },
      });
    }
  }

  return [];
};

type CacheEntry = { models: string[]; fetchedAt: number };

const caches = new Map<string, CacheEntry>();

const readCache = (key: string): string[] | null => {
  const cached = caches.get(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt >= CACHE_TTL_MS) {
    caches.delete(key);
    return null;
  }
  return cached.models;
};

export const getProviderModels = async (providerType: string): Promise<string[]> => {
  const cached = readCache(providerType);
  if (cached) return cached;

  const fetched = await fetchModelsFromDev(providerType);
  if (fetched.length > 0) {
    caches.set(providerType, { models: fetched, fetchedAt: Date.now() });
    return fetched;
  }

  try {
    return getProviderConfig(providerType).models;
  } catch {
    return [];
  }
};

export const getProviderModelsForRecord = async (params: {
  providerId: string;
  providerType: string;
  baseUrl?: string;
  apiKey?: string;
  forceRefresh?: boolean;
}): Promise<string[]> => {
  const cacheKey = `record:${params.providerId}`;
  if (!params.forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  let storedConfig: ReturnType<typeof getProviderConfig> | null = null;
  try {
    storedConfig = getProviderConfig(params.providerType, params.providerId);
  } catch {
    storedConfig = null;
  }

  const resolvedBaseUrl =
    params.baseUrl?.trim() ||
    storedConfig?.baseURL?.trim() ||
    DEFAULT_PROVIDER_BASE_URLS[params.providerType] ||
    '';
  const resolvedApiKey = params.apiKey?.trim() || storedConfig?.apiKey?.trim() || '';

  const live = await fetchLiveProviderModels({
    baseUrl: resolvedBaseUrl,
    ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    providerType: params.providerType,
  });
  if (live.length > 0) {
    caches.set(cacheKey, { models: live, fetchedAt: Date.now() });
    return live;
  }

  const catalog = await fetchModelsFromDev(params.providerType);
  if (catalog.length > 0) return catalog;

  return storedConfig?.models ?? [];
};

export const resetModelDiscoveryCacheForTests = () => {
  caches.clear();
};
