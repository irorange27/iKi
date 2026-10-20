import { fetchModelsFromDev, getProviderConfig } from './factory';
import { fetchWithTimeout } from '../../network/http';
import { createLogger } from '@iki/backend/logger';

const modelDiscoveryLogger = createLogger({ module: 'llm_model_discovery' });

const CACHE_TTL_MS = 3600000;
const LIVE_MODEL_LIST_TIMEOUT_MS = 8000;

/**
 * Live model lists come from the provider itself, not the static catalog: a
 * custom openai-compatible endpoint is the whole point of a custom provider, so
 * asking models.dev about it can only ever return that type's generic list.
 * `GET {baseUrl}/models` is the de-facto standard across OpenAI-compatible,
 * Ollama (/api/tags fallback) and Anthropic-compatible gateways.
 */
const buildModelListUrls = (baseUrl: string): string[] => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return [];

  // Ollama exposes its models at /api/tags and its OpenAI shim at /v1/models.
  if (/localhost|127\.0\.0\.1/.test(trimmed) && /:11434$/.test(trimmed)) {
    return [`${trimmed}/api/tags`, `${trimmed}/v1/models`];
  }

  // A base URL already ending in a version segment needs no /v1 appended.
  return [trimmed.endsWith('/v1') ? `${trimmed}/models` : `${trimmed}/v1/models`];
};

const extractModelIds = (payload: unknown): string[] => {
  const readId = (entry: unknown): string | null => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (!entry || typeof entry !== 'object') return null;

    const record = entry as Record<string, unknown>;
    for (const key of ['id', 'name', 'model']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return null;
  };

  // OpenAI-compatible /v1/models: { data: [{ id }] }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    const ids = (payload as { data: unknown[] }).data
      .map(readId)
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) return ids;
  }

  // Ollama /api/tags: { models: [{ name }] } — also the common `{ models: [...] }`
  // shape some gateways use instead of `data`.
  if (payload && typeof payload === 'object' && Array.isArray((payload as { models?: unknown }).models)) {
    const ids = (payload as { models: unknown[] }).models
      .map(readId)
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) return ids;
  }

  // Bare array of ids or objects.
  if (Array.isArray(payload)) {
    return payload.map(readId).filter((id): id is string => Boolean(id));
  }

  return [];
};

/**
 * Ask the provider's own endpoint for its model list. Returns an empty list
 * when the endpoint is unreachable, unauthenticated, or answers in a shape we
 * do not recognise — discovery is best-effort and never blocks the caller.
 */
export const fetchLiveProviderModels = async (params: {
  baseUrl: string;
  apiKey?: string;
}): Promise<string[]> => {
  const urls = buildModelListUrls(params.baseUrl);
  if (urls.length === 0) return [];

  const headers: Record<string, string> = { accept: 'application/json' };
  const apiKey = params.apiKey?.trim();
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(
        url,
        { method: 'GET', headers },
        { timeoutMs: LIVE_MODEL_LIST_TIMEOUT_MS, retries: 0 }
      );

      if (!response.ok) continue;

      const modelIds = extractModelIds(await response.json());
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

/**
 * Model discovery for static provider types: models.dev catalog first, then the
 * provider's own configured model list. One cache slot per provider type.
 */
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

/**
 * Discovery for a specific provider row (custom or built-in). Live endpoint
 * first — that is the only source that can know about a private gateway —
 * then the static catalog, then the provider's stored model list. Cached per
 * provider id so repeated opens of the models panel do not re-hit the network.
 */
export const getProviderModelsForRecord = async (params: {
  providerId: string;
  providerType: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<string[]> => {
  const cacheKey = `record:${params.providerId}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const live = await fetchLiveProviderModels({
    baseUrl: params.baseUrl ?? '',
    ...(params.apiKey ? { apiKey: params.apiKey } : {}),
  });
  if (live.length > 0) {
    caches.set(cacheKey, { models: live, fetchedAt: Date.now() });
    return live;
  }

  const catalog = await fetchModelsFromDev(params.providerType);
  if (catalog.length > 0) return catalog;

  try {
    return getProviderConfig(params.providerType, params.providerId).models;
  } catch {
    return [];
  }
};

export const resetModelDiscoveryCacheForTests = () => {
  caches.clear();
};
