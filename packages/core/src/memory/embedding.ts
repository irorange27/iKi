import { createLogger } from '../logger';
import { getAppConfig } from '../config';
import { getProviders } from '../db/providers';
import { getProviderConfig } from '../provider/llm/factory';
import { fetchWithTimeout } from '@iki/backend/network/http';
import {
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  listProviderEmbeddingModels,
} from '../utils/memory_embedding_models';

const memoryEmbeddingLogger = createLogger({ module: 'memory_embedding' });

export const HASH_EMBEDDING_DIM = 128;
export const HASH_EMBEDDING_VERSION = 1;
export const PROVIDER_EMBEDDING_VERSION = 1;

const EMBEDDING_PROVIDER_PRIORITY = [
  'openai',
  'openai-compatible',
  'kimi',
  'deepseek',
  'ollama',
];

export type MemoryEmbeddingFingerprint = {
  strategy: 'hash' | 'provider';
  version: number;
  dimensions: number;
  providerType?: string;
  providerId?: string;
  model?: string;
};

export type MemoryEmbeddingResult = {
  vector: number[];
  fingerprint: MemoryEmbeddingFingerprint;
};

export type MemoryEmbeddingRuntime = {
  fingerprint: MemoryEmbeddingFingerprint;
  embed: (texts: string[]) => Promise<MemoryEmbeddingResult[]>;
};

type ResolvedEmbeddingProvider = {
  providerType: string;
  providerId: string;
  model: string;
  apiKey: string;
  baseUrl: string;
};

const tokenize = (text: string): string[] => {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return matches ? matches : [];
};

const hashToken = (token: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map(value => value / norm);
};

const buildHashVector = (text: string): number[] => {
  const vector = new Array(HASH_EMBEDDING_DIM).fill(0);
  for (const token of tokenize(text)) {
    const hash = hashToken(token);
    const index = hash % HASH_EMBEDDING_DIM;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign;
  }
  return normalizeVector(vector);
};

const buildHashFingerprint = (): MemoryEmbeddingFingerprint => ({
  strategy: 'hash',
  version: HASH_EMBEDDING_VERSION,
  dimensions: HASH_EMBEDDING_DIM,
});

const normalizeOpenAiCompatibleBaseUrl = (providerType: string, baseUrl?: string): string | null => {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  const fallback =
    providerType === 'openai'
      ? 'https://api.openai.com/v1'
      : providerType === 'kimi'
        ? 'https://api.moonshot.cn/v1'
        : providerType === 'deepseek'
          ? 'https://api.deepseek.com/v1'
          : providerType === 'ollama'
            ? 'http://localhost:11434/v1'
            : '';
  const base = trimmed || fallback;
  if (!base) return null;
  const withoutTrailing = base.endsWith('/') ? base.slice(0, -1) : base;
  if (withoutTrailing.endsWith('/v1')) return withoutTrailing;
  return `${withoutTrailing}/v1`;
};

const resolveProviderPriority = (providerType: string): number => {
  const index = EMBEDDING_PROVIDER_PRIORITY.indexOf(providerType);
  return index >= 0 ? index : EMBEDDING_PROVIDER_PRIORITY.length + 1;
};

const getConfiguredEmbeddingSelection = (): {
  providerId: string;
  providerType: string;
  model: string;
} | null => {
  const selection = getAppConfig()?.memory?.embeddingModel;
  if (!selection || typeof selection !== 'object') return null;

  const providerId =
    typeof selection.providerId === 'string' ? selection.providerId.trim() : '';
  const providerType =
    typeof selection.providerType === 'string' ? selection.providerType.trim() : '';
  const model = typeof selection.model === 'string' ? selection.model.trim() : '';

  if (!model || (!providerId && !providerType)) {
    return null;
  }

  return {
    providerId,
    providerType,
    model,
  };
};

const resolveConfiguredProvider = (
  providerType: string,
  providerId: string,
  model: string
): ResolvedEmbeddingProvider | null => {
  try {
    const config = getProviderConfig(providerType, providerId);
    const baseUrl = normalizeOpenAiCompatibleBaseUrl(providerType, config.baseURL);
    if (!baseUrl) return null;

    const requiresApiKey = providerType !== 'ollama';
    if (requiresApiKey && !config.apiKey.trim()) {
      return null;
    }

    return {
      providerType,
      providerId: config.id,
      model,
      apiKey: config.apiKey,
      baseUrl,
    };
  } catch {
    return null;
  }
};

const resolveSelectedEmbeddingProvider = (): ResolvedEmbeddingProvider | null => {
  const selection = getConfiguredEmbeddingSelection();
  if (!selection) return null;

  const providers = getProviders().filter(provider => provider.enabled);
  const matchedProvider = selection.providerId
    ? providers.find(provider => provider.id === selection.providerId)
    : providers.find(provider => provider.type === selection.providerType);
  if (!matchedProvider) return null;

  return resolveConfiguredProvider(
    selection.providerType || matchedProvider.type,
    matchedProvider.id,
    selection.model
  );
};

const resolveOpenAiEmbeddingProvider = (): ResolvedEmbeddingProvider | null => {
  const providers = getProviders()
    .filter(provider => provider.enabled && provider.type === 'openai')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const provider of providers) {
    const resolved = resolveConfiguredProvider(
      provider.type,
      provider.id,
      DEFAULT_MEMORY_EMBEDDING_MODEL
    );
    if (resolved) return resolved;
  }

  return null;
};

const resolveAdvertisedEmbeddingProvider = (): ResolvedEmbeddingProvider | null => {
  const providers = getProviders()
    .filter(provider => provider.enabled && provider.type !== 'anthropic')
    .sort((a, b) => {
      const priorityDelta = resolveProviderPriority(a.type) - resolveProviderPriority(b.type);
      if (priorityDelta !== 0) return priorityDelta;
      return a.created_at.localeCompare(b.created_at);
    });

  for (const provider of providers) {
    const model = listProviderEmbeddingModels(provider)[0] || null;
    if (!model) continue;
    const resolved = resolveConfiguredProvider(provider.type, provider.id, model);
    if (resolved) return resolved;
  }

  return null;
};

const resolveEmbeddingProvider = (): ResolvedEmbeddingProvider | null => {
  return (
    resolveSelectedEmbeddingProvider() ||
    resolveOpenAiEmbeddingProvider() ||
    resolveAdvertisedEmbeddingProvider()
  );
};

const toProviderFingerprint = (
  provider: ResolvedEmbeddingProvider,
  dimensions: number
): MemoryEmbeddingFingerprint => ({
  strategy: 'provider',
  version: PROVIDER_EMBEDDING_VERSION,
  dimensions,
  providerType: provider.providerType,
  providerId: provider.providerId,
  model: provider.model,
});

const validateEmbeddingArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;

  const vector = value.map(entry => (typeof entry === 'number' && Number.isFinite(entry) ? entry : 0));
  return normalizeVector(vector);
};

const fetchProviderEmbeddings = async (
  provider: ResolvedEmbeddingProvider,
  texts: string[]
): Promise<MemoryEmbeddingResult[]> => {
  const response = await fetchWithTimeout(`${provider.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      input: texts,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Embedding request failed with status ${response.status}${body ? `: ${body}` : ''}`
    );
  }

  const parsed = (await response.json()) as {
    data?: Array<{ index?: number; embedding?: unknown }>;
  };

  if (!Array.isArray(parsed.data) || parsed.data.length !== texts.length) {
    throw new Error('Embedding response returned an unexpected result count');
  }

  const ordered = [...parsed.data].sort((a, b) => (a.index || 0) - (b.index || 0));
  const vectors = ordered.map(item => validateEmbeddingArray(item.embedding));
  if (vectors.some(vector => !vector)) {
    throw new Error('Embedding response contained an invalid embedding vector');
  }

  const dimensions = vectors[0]?.length || 0;
  const fingerprint = toProviderFingerprint(provider, dimensions);

  return vectors.map(vector => ({
    vector: vector as number[],
    fingerprint,
  }));
};

export const createHashMemoryEmbeddingRuntime = (): MemoryEmbeddingRuntime => ({
  fingerprint: buildHashFingerprint(),
  embed: async texts =>
    texts.map(text => ({
      vector: buildHashVector(text),
      fingerprint: buildHashFingerprint(),
    })),
});

export const createPreferredMemoryEmbeddingRuntime = (): MemoryEmbeddingRuntime => {
  const provider = resolveEmbeddingProvider();
  if (!provider) {
    return createHashMemoryEmbeddingRuntime();
  }

  return {
    fingerprint: {
      strategy: 'provider',
      version: PROVIDER_EMBEDDING_VERSION,
      dimensions: 0,
      providerType: provider.providerType,
      providerId: provider.providerId,
      model: provider.model,
    },
    embed: async texts => {
      const normalizedTexts = texts.map(text => (typeof text === 'string' ? text : ''));
      if (normalizedTexts.length === 0) return [];
      return await fetchProviderEmbeddings(provider, normalizedTexts);
    },
  };
};

export const embedTextsWithFallback = async (
  texts: string[]
): Promise<{ results: MemoryEmbeddingResult[]; degraded: boolean }> => {
  const runtime = createPreferredMemoryEmbeddingRuntime();
  try {
    return {
      results: await runtime.embed(texts),
      degraded: runtime.fingerprint.strategy !== 'provider',
    };
  } catch (error) {
    memoryEmbeddingLogger.event({
      level: 'warn',
      event: 'memory.embedding.provider_fallback',
      outcome: 'degraded',
      error,
      fallback_applied: true,
      data: {
        provider_type: runtime.fingerprint.providerType || null,
        provider_id: runtime.fingerprint.providerId || null,
        model: runtime.fingerprint.model || null,
        text_count: texts.length,
      },
    });

    return {
      results: await createHashMemoryEmbeddingRuntime().embed(texts),
      degraded: true,
    };
  }
};
