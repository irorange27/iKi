import {
  builtinProviders,
  getBuiltinModels,
  getBuiltinProviders,
  type BuiltinProvider,
} from '@earendil-works/pi-ai/providers/all';
import { findEnvKeys, getEnvApiKey } from '@earendil-works/pi-ai/compat';
import type { Api, Model } from '@earendil-works/pi-ai';

export type PiProviderSummary = {
  id: string;
  name: string;
  defaultApi: Api;
  defaultBaseUrl: string;
  defaultModel: string;
  modelCount: number;
  models: string[];
};

export type PiDetectedEnvProvider = {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  sourceEnv: string;
};

/** Legacy iKi provider aliases mapped onto canonical pi-ai provider IDs. */
const LEGACY_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  kimi: 'moonshotai-cn',
  moonshot: 'moonshotai-cn',
};

/** Preferred display ordering for onboarding & pickers; all other pi-ai providers follow alphabetically. */
const PRIORITY_PROVIDER_IDS: readonly string[] = [
  'anthropic',
  'openai',
  'deepseek',
  'google',
  'openrouter',
  'moonshotai-cn',
  'moonshotai',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'qwen-token-plan-cn',
  'zai-coding-cn',
  'xai',
  'groq',
  'mistral',
  'together',
  'fireworks',
  'cerebras',
  'amazon-bedrock',
  'google-vertex',
  'azure',
  'github-copilot',
  'openai-codex',
  'vercel-ai-gateway',
];

let cachedSummaries: PiProviderSummary[] | null = null;
let cachedProviderMap: Map<string, PiProviderSummary> | null = null;

const builtinSet = (): Set<string> => new Set(getBuiltinProviders() as string[]);

export const normalizePiProviderId = (providerType: string): string => {
  const trimmed = providerType.trim().toLowerCase();
  return LEGACY_PROVIDER_ALIASES[trimmed] ?? trimmed;
};

const EXCLUDED_DEFAULT_RE = /(?:^~|deep-research|computer-use|safeguard|embed|tts|whisper|audio|realtime|image)/i;
const PREFERRED_DEFAULT_PATTERNS: readonly RegExp[] = [
  /^claude-sonnet-/i,
  /^gpt-5(?:\.|\b)/i,
  /^gpt-4\.1$/i,
  /^gemini-2\.5-pro$/i,
  /^gemini-2\.5-flash$/i,
  /^deepseek-v4-pro$/i,
  /^deepseek-chat$/i,
  /^anthropic\/claude-sonnet-/i,
  /^devstral-latest$/i,
  /^llama-3\.3-70b-versatile$/i,
];

const pickDefaultModel = (models: readonly Model<Api>[]): Model<Api> => {
  const usable = models.filter(m => !EXCLUDED_DEFAULT_RE.test(m.id));
  const pool = usable.length > 0 ? usable : models;
  for (const pattern of PREFERRED_DEFAULT_PATTERNS) {
    const match = pool.find(m => pattern.test(m.id));
    if (match) return match;
  }
  return pool[0]!;
};

const buildCatalog = (): { list: PiProviderSummary[]; byId: Map<string, PiProviderSummary> } => {
  if (cachedSummaries && cachedProviderMap) {
    return { list: cachedSummaries, byId: cachedProviderMap };
  }

  const nameById = new Map<string, string>();
  for (const provider of builtinProviders()) {
    nameById.set(provider.id, provider.name);
  }

  const summaries: PiProviderSummary[] = [];
  for (const id of getBuiltinProviders()) {
    const models = getBuiltinModels(id);
    if (models.length === 0) continue;
    const picked = pickDefaultModel(models);
    summaries.push({
      id,
      name: nameById.get(id) ?? id,
      defaultApi: picked.api,
      defaultBaseUrl: typeof picked.baseUrl === 'string' ? picked.baseUrl : '',
      defaultModel: picked.id,
      modelCount: models.length,
      models: models.map(m => m.id),
    });
  }

  const priorityRank = new Map<string, number>(
    PRIORITY_PROVIDER_IDS.map((id, idx) => [id, idx])
  );
  summaries.sort((a, b) => {
    const ra = priorityRank.get(a.id) ?? 9999;
    const rb = priorityRank.get(b.id) ?? 9999;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });

  cachedSummaries = summaries;
  cachedProviderMap = new Map(summaries.map(s => [s.id, s]));
  return { list: cachedSummaries, byId: cachedProviderMap };
};

export const listPiBuiltinProviders = (): PiProviderSummary[] => buildCatalog().list;

export const getPiBuiltinProvider = (providerType: string): PiProviderSummary | null => {
  const canonical = normalizePiProviderId(providerType);
  return buildCatalog().byId.get(canonical) ?? null;
};

export const listPiBuiltinModelIds = (providerType: string): string[] =>
  getPiBuiltinProvider(providerType)?.models ?? [];

export const lookupPiBuiltinModel = (
  providerType: string,
  modelId: string
): Model<Api> | null => {
  const canonical = normalizePiProviderId(providerType);
  if (!builtinSet().has(canonical)) return null;
  const target = modelId.trim();
  if (!target) return null;
  const models = getBuiltinModels(canonical as BuiltinProvider);
  return (
    models.find(m => m.id === target) ??
    models.find(m => m.id.toLowerCase() === target.toLowerCase()) ??
    null
  );
};

/**
 * Auto-detects any configured API key across all built-in pi-ai providers (plus IKI_BASE_URL).
 */
export const detectPiEnvProviders = (
  env: Readonly<Record<string, string | undefined>> = process.env
): PiDetectedEnvProvider[] => {
  const detected: PiDetectedEnvProvider[] = [];

  const customBaseUrl = env.IKI_BASE_URL?.trim();
  const customApiKey = env.IKI_API_KEY?.trim();
  const customModel = env.IKI_MODEL?.trim();
  if (customBaseUrl) {
    detected.push({
      id: 'custom',
      name: 'Custom Gateway',
      type: 'openai-compatible',
      apiKey: customApiKey || 'not-required',
      baseUrl: customBaseUrl,
      models: customModel ? [customModel] : [],
      sourceEnv: customApiKey ? 'IKI_BASE_URL + IKI_API_KEY' : 'IKI_BASE_URL',
    });
  }

  // Deduplicate shared env vars (e.g. MOONSHOT_API_KEY maps to both moonshotai-cn and moonshotai).
  const claimedEnvKeys = new Set<string>();

  for (const summary of listPiBuiltinProviders()) {
    const envKeys = findEnvKeys(summary.id, env);
    if (!envKeys || envKeys.length === 0) continue;
    const primaryKey = envKeys[0]!;
    if (claimedEnvKeys.has(primaryKey)) continue;

    const apiKey = getEnvApiKey(summary.id, env)?.trim();
    if (!apiKey) continue;

    claimedEnvKeys.add(primaryKey);
    const upperPrefix = summary.id.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    const baseUrlOverride = env[`${upperPrefix}_BASE_URL`]?.trim();
    const modelOverride = env[`${upperPrefix}_MODEL`]?.trim();

    detected.push({
      id: summary.id,
      name: summary.name,
      type: summary.id,
      apiKey,
      baseUrl: baseUrlOverride || summary.defaultBaseUrl,
      models: [modelOverride || summary.defaultModel],
      sourceEnv: primaryKey,
    });
  }

  return detected;
};
