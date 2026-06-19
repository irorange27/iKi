import { generateText, smoothStream, streamText, type LanguageModel, type ModelMessage } from 'ai';
import type { JSONValue, SharedV3ProviderOptions } from '@ai-sdk/provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createMinimax } from 'vercel-minimax-ai-provider';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getProviders } from '@iki/core/context/provider_store';
import { createLogger } from '@iki/core/logger';
import { getPersonaPrompt } from '@iki/core/context/persona_provider';
import { fetchWithTimeout } from '@iki/core/context/network_provider';
import { getToolRuntimeContext } from '@iki/core/tools/runtime_context';
import {
  getProviderModelOptions,
  listModelsDevProviderModels,
  lookupModelsDevModelCapability,
  mergeModelCapability,
  parseModelList,
  parseProviderModelOptionsMap,
  type ModelCapability,
  type ModelsDevCatalog,
} from '@iki/core/utils/provider_models';
import type {
  ProviderModelDiscoveryOverride,
  ProviderModelOptions,
  ProviderModelOptionsMap,
} from '@iki/core/types/provider';
import type { TokenUsageMetrics } from '@iki/core/types/chat_usage';
import {
  createAcpLanguageModel,
  disposeAcpLanguageModel,
  fetchAcpAuthMethods as fetchAcpAuthMethodsFromSession,
  fetchAcpModels as fetchAcpModelsFromSession,
  isAcpProviderType,
  type AcpAuthMethod,
} from './acp';

export type { AcpAuthMethod };
import { normalizeLanguageModelUsage } from './usage';

const factoryLogger = createLogger({ module: 'llm_factory' });
const MODELS_DEV_CACHE_TTL_MS = 3600000;
const MODELS_DEV_TIMEOUT_MS = 1200;
const MODELS_DEV_FAILURE_COOLDOWN_MS = 300000;

let cachedModelsDevCatalog: ModelsDevCatalog | null = null;
let cachedModelsDevFetchedAt = 0;
let cachedModelsDevUnavailableUntil = 0;
let modelsDevRefreshInFlight: Promise<ModelsDevCatalog | null> | null = null;

export interface ProviderConfig {
  id: string;
  type: string;
  apiKey: string;
  baseURL: string;
  models: string[];
  modelOptions: ProviderModelOptionsMap;
  isResponseApi: boolean;
  acpCommand: string;
  acpArgs: string;
  acpMcpServerIds: string;
  acpAuthMethodId: string;
  acpApiProviderId: string;
  acpModelMapping: string;
}

export interface ChatGenerationResult {
  text: string;
  usage: TokenUsageMetrics;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isLanguageModelInstance = (value: unknown): value is LanguageModel => {
  if (!isObjectRecord(value)) return false;

  return (
    value.specificationVersion === 'v3' &&
    typeof value.provider === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.doGenerate === 'function' &&
    typeof value.doStream === 'function' &&
    'supportedUrls' in value
  );
};

const readBootstrapAuthConfig = (providerType: string): ProviderConfig | null => {
  try {
    const filePath = path.join(os.homedir(), '.iki', 'agent', 'auth.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const entry = raw?.[providerType];
    if (!entry || entry.type !== 'api_key' || !entry.key) return null;

    return {
      id: `_bootstrap_${providerType}`,
      type: providerType,
      apiKey: entry.key,
      baseURL: '',
      models: [],
      modelOptions: {},
      isResponseApi: false,
      acpCommand: '',
      acpArgs: '',
      acpMcpServerIds: '',
      acpAuthMethodId: '',
      acpApiProviderId: '',
      acpModelMapping: '',
    };
  } catch {
    return null;
  }
};

export const getProviderConfig = (providerType: string, providerId?: string | null): ProviderConfig => {
  let providers: ReturnType<typeof getProviders> = [];
  try {
    providers = getProviders();
  } catch {
    // DB unavailable — fall through to auth.json bootstrap
  }
  const normalizedProviderId =
    typeof providerId === 'string' && providerId.trim().length > 0 ? providerId.trim() : '';
  const provider = normalizedProviderId
    ? providers.find(p => p.id === normalizedProviderId && p.enabled)
    : providers.find(p => p.type === providerType && p.enabled);

  if (!provider) {
    if (normalizedProviderId) {
      throw new Error(`Provider ${normalizedProviderId} is not configured or not enabled`);
    }
    // Fallback to auth.json bootstrap before throwing
    const bootstrap = readBootstrapAuthConfig(providerType);
    if (bootstrap) return bootstrap;
    throw new Error(`Provider ${providerType} not configured or not enabled`);
  }

  if (providerType && provider.type !== providerType) {
    throw new Error(
      `Provider ${provider.id} is type "${provider.type}", not the requested "${providerType}".`
    );
  }

  const models = parseModelList(provider.models);

  return {
    id: provider.id,
    type: provider.type,
    apiKey: provider.api_key,
    baseURL: provider.base_url || '',
    models,
    modelOptions: parseProviderModelOptionsMap(provider.model_options),
    isResponseApi: provider.is_response_api === true,
    acpCommand: provider.acp_command || '',
    acpArgs: provider.acp_args || '',
    acpMcpServerIds: provider.acp_mcp_server_ids || '',
    acpAuthMethodId: provider.acp_auth_method_id || '',
    acpApiProviderId: provider.acp_api_provider_id || '',
    acpModelMapping: provider.acp_model_mapping || '',
  };
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildProviderConfigForDiscovery = (params: {
  providerType: string;
  providerId?: string | null;
  providerOverride?: ProviderModelDiscoveryOverride | null;
}): ProviderConfig => {
  const override = params.providerOverride;
  if (!override) {
    return getProviderConfig(params.providerType, params.providerId);
  }

  let persisted: ProviderConfig | null = null;
  try {
    persisted = getProviderConfig(params.providerType, params.providerId);
  } catch {
    persisted = null;
  }

  const resolvedType =
    normalizeOptionalString(override.type) ?? normalizeOptionalString(persisted?.type) ?? params.providerType;
  const resolvedId =
    normalizeOptionalString(override.id) ??
    normalizeOptionalString(persisted?.id) ??
    normalizeOptionalString(params.providerId) ??
    `${resolvedType}_draft`;

  return {
    id: resolvedId,
    type: resolvedType,
    apiKey:
      normalizeOptionalString(override.api_key) ?? normalizeOptionalString(persisted?.apiKey) ?? '',
    baseURL:
      normalizeOptionalString(override.base_url) ??
      normalizeOptionalString(persisted?.baseURL) ??
      '',
    models:
      override.models !== undefined
        ? parseModelList(override.models)
        : persisted?.models
          ? [...persisted.models]
          : [],
    modelOptions:
      override.model_options !== undefined
        ? parseProviderModelOptionsMap(override.model_options)
        : persisted?.modelOptions
          ? structuredClone(persisted.modelOptions)
          : {},
    isResponseApi:
      typeof override.is_response_api === 'boolean'
        ? override.is_response_api
        : persisted?.isResponseApi === true,
    acpCommand:
      normalizeOptionalString(override.acp_command) ??
      normalizeOptionalString(persisted?.acpCommand) ??
      '',
    acpArgs:
      normalizeOptionalString(override.acp_args) ?? normalizeOptionalString(persisted?.acpArgs) ?? '',
    acpMcpServerIds:
      normalizeOptionalString(override.acp_mcp_server_ids) ??
      normalizeOptionalString(persisted?.acpMcpServerIds) ??
      '',
    acpAuthMethodId:
      normalizeOptionalString(override.acp_auth_method_id) ??
      normalizeOptionalString(persisted?.acpAuthMethodId) ??
      '',
    acpApiProviderId:
      normalizeOptionalString(override.acp_api_provider_id) ??
      normalizeOptionalString(persisted?.acpApiProviderId) ??
      '',
    acpModelMapping:
      normalizeOptionalString(override.acp_model_mapping) ??
      normalizeOptionalString(persisted?.acpModelMapping) ??
      '',
  };
};

const getStoredProviderModelOptions = (
  providerType: string,
  modelId: string,
  providerId?: string | null
) => {
  try {
    const config = getProviderConfig(providerType, providerId);
    return getProviderModelOptions(config.modelOptions, modelId);
  } catch {
    return null;
  }
};

const getStoredProviderModelContext = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): { config: ProviderConfig; modelOptions: ProviderModelOptions | null } | null => {
  try {
    const config = getProviderConfig(providerType, providerId);
    return {
      config,
      modelOptions: getProviderModelOptions(config.modelOptions, modelId),
    };
  } catch {
    return null;
  }
};

const normalizeOptionalLowercaseString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

const shouldOmitTemperatureForModelCall = (params: {
  providerType: string;
  modelId: string;
  providerId?: string | null;
  temperature?: number;
}): boolean => {
  if (typeof params.temperature !== 'number') return false;

  const storedContext = getStoredProviderModelContext(
    params.providerType,
    params.modelId,
    params.providerId
  );
  const usesOpenAISdkCompatibilityRules =
    params.providerType === 'openai' || storedContext?.config.isResponseApi === true;

  if (!usesOpenAISdkCompatibilityRules) {
    return false;
  }

  const providerOptions = storedContext?.modelOptions?.providerOptions;
  const reasoningEffort = normalizeOptionalLowercaseString(providerOptions?.reasoningEffort);
  if (reasoningEffort === 'none') {
    return false;
  }

  return (
    providerOptions?.forceReasoning === true ||
    storedContext?.modelOptions?.supportsReasoning === true ||
    reasoningEffort !== null
  );
};

export const getModelCallSettings = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): { providerOptions?: SharedV3ProviderOptions } => {
  const modelOptions = getStoredProviderModelOptions(providerType, modelId, providerId);
  const providerOptions = modelOptions?.providerOptions;

  const merged: Record<string, JSONValue> = { ...(providerOptions ?? {}) };

  if (modelOptions?.supportsReasoning != null && !merged.thinking) {
    merged.thinking = { type: modelOptions.supportsReasoning ? 'enabled' : 'disabled' };
  }

  if (Object.keys(merged).length === 0) {
    return {};
  }

  return {
    providerOptions: {
      [providerType]: merged,
    },
  };
};

export const getModelGenerationSettings = (params: {
  providerType: string;
  modelId: string;
  providerId?: string | null;
  temperature?: number;
}): { providerOptions?: SharedV3ProviderOptions; temperature?: number } => {
  const callSettings = getModelCallSettings(params.providerType, params.modelId, params.providerId);

  if (shouldOmitTemperatureForModelCall(params)) {
    return callSettings;
  }

  return typeof params.temperature === 'number'
    ? {
        ...callSettings,
        temperature: params.temperature,
      }
    : callSettings;
};

const createInstrumentedFetch = (): typeof globalThis.fetch => {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';

    if (method === 'POST' && url.includes('/chat/completions')) {
      const bodyText = init?.body as string;
      try {
        const body = JSON.parse(bodyText);
        if (!body.thinking) {
          body.thinking = { type: 'disabled' };
        }
        return globalThis.fetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        // If we can't parse the body, pass through unchanged
      }
    }
    return globalThis.fetch(input, init);
  };
};

export const createModel = (
  providerType: string,
  modelId: string,
  providerId?: string | null
): LanguageModel => {
  const config = getProviderConfig(providerType, providerId);

  // Validations: If no modelId, try to pick the first one from config
  if (!modelId && config.models.length > 0) {
    modelId = config.models[0];
  }

  if (!modelId) {
    throw new Error(
      `Model not specified for provider "${providerType}". Please select a model in chat or update settings.`
    );
  }

  const storedModelOptions = getProviderModelOptions(config.modelOptions, modelId);

  if (isAcpProviderType(providerType)) {
    const toolRuntimeContext = getToolRuntimeContext();
    return createAcpLanguageModel(
      {
        id: config.id,
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        acpCommand: config.acpCommand,
        acpArgs: config.acpArgs,
        acpMcpServerIds: config.acpMcpServerIds,
        acpAuthMethodId: config.acpAuthMethodId,
        acpApiProviderId: config.acpApiProviderId,
        acpModelMapping: config.acpModelMapping,
      },
      modelId,
      toolRuntimeContext.threadId
    );
  }

  if (providerType === 'openai') {
    const client = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.openai.com/v1',
    });
    return client(modelId);
  }
  if (providerType === 'anthropic' || providerType === 'anthropic-compatible') {
    const client = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.anthropic.com/v1',
      ...(providerType === 'anthropic-compatible' ? { name: providerType } : {}),
    });
    const model = client(modelId);
    if (!isLanguageModelInstance(model)) {
      throw new Error(`Anthropic provider returned an invalid language model for "${modelId}".`);
    }
    return model;
  }
  if (providerType === 'deepseek') {
    const client = createDeepSeek({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
    });
    return client(modelId);
  }
  if (providerType === 'minimax') {
    const client = createMinimax({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.minimax.io/anthropic/v1',
    });
    const model = client(modelId);
    if (!isLanguageModelInstance(model)) {
      throw new Error(`MiniMax provider returned an invalid language model for "${modelId}".`);
    }
    return model;
  }

  if (config.isResponseApi) {
    const client = createOpenAI({
      name: providerType,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    return client.responses(modelId);
  }

  // Default to OpenAI compatible for most other providers
  const client = createOpenAICompatible({
    name: providerType,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    fetch: createInstrumentedFetch(),
  });
  if (typeof storedModelOptions?.supportsStructuredOutputs === 'boolean') {
    return client.languageModel(modelId, {
      supportsStructuredOutputs: storedModelOptions.supportsStructuredOutputs,
    });
  }

  return client(modelId);
};

export const disposeLanguageModel = (model: LanguageModel): void => {
  disposeAcpLanguageModel(model);
};

export const getFullSystemPrompt = (providerType: string, providerId?: string | null) => {
  getProviderConfig(providerType, providerId);
  const personaPrompt = getPersonaPrompt();
  return personaPrompt;
};
export const generateChatWithModelMessages = async (options: {
  providerType: string;
  providerId?: string;
  modelId: string;
  messages: ModelMessage[];
  extraSystemPrompt?: string;
  maxOutputTokens?: number;
}): Promise<ChatGenerationResult> => {
  const model = createModel(options.providerType, options.modelId, options.providerId);
  const systemPrompt = [
    getFullSystemPrompt(options.providerType, options.providerId),
    options.extraSystemPrompt,
  ]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: injectReasoningContentIntoMessages(options.messages),
      ...getModelCallSettings(options.providerType, options.modelId, options.providerId),
      ...(typeof options.maxOutputTokens === 'number'
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
    });

    if (!result.text) {
      factoryLogger.event({
        level: 'warn',
        event: 'llm.generate.empty',
        outcome: 'degraded',
        message: `Generation produced no text for provider "${options.providerType}" model "${options.modelId}".`,
        data: { providerType: options.providerType, modelId: options.modelId },
      });
    }
    return {
      text: result.text,
      usage: normalizeLanguageModelUsage(result.totalUsage || result.usage),
    };
  } catch (error) {
    factoryLogger.event({
      level: 'error',
      event: 'llm.generate.failed',
      outcome: 'failed',
      message: `Generation failed for provider "${options.providerType}" model "${options.modelId}".`,
      error,
      data: { providerType: options.providerType, modelId: options.modelId },
    });
    throw error;
  } finally {
    disposeLanguageModel(model);
  }
};

export const fetchModelsFromDev = async (providerType: string) => {
  try {
    const data = await refreshModelsDevCatalog();
    return data ? listModelsDevProviderModels(data, providerType) : [];
  } catch {
    return [];
  }
};

export const fetchAcpModels = async (
  providerType: string,
  providerId?: string | null,
  providerOverride?: ProviderModelDiscoveryOverride | null
) => {
  const config = buildProviderConfigForDiscovery({
    providerType,
    providerId,
    providerOverride,
  });
  if (!isAcpProviderType(config.type)) {
    return [];
  }

  return await fetchAcpModelsFromSession({
    id: config.id,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    acpCommand: config.acpCommand,
    acpArgs: config.acpArgs,
    acpMcpServerIds: config.acpMcpServerIds,
    acpAuthMethodId: config.acpAuthMethodId,
    acpApiProviderId: config.acpApiProviderId,
    acpModelMapping: config.acpModelMapping,
  });
};

export const fetchAcpAuthMethods = async (
  providerType: string,
  providerId?: string | null,
  providerOverride?: ProviderModelDiscoveryOverride | null
) => {
  const config = buildProviderConfigForDiscovery({
    providerType,
    providerId,
    providerOverride,
  });
  if (!isAcpProviderType(config.type)) {
    return [];
  }

  return await fetchAcpAuthMethodsFromSession({
    id: config.id,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    acpCommand: config.acpCommand,
    acpArgs: config.acpArgs,
    acpMcpServerIds: config.acpMcpServerIds,
    acpAuthMethodId: config.acpAuthMethodId,
    acpApiProviderId: config.acpApiProviderId,
    acpModelMapping: config.acpModelMapping,
  });
};

const hasFreshModelsDevCatalog = (now = Date.now()) =>
  Boolean(cachedModelsDevCatalog && now - cachedModelsDevFetchedAt < MODELS_DEV_CACHE_TTL_MS);

const startModelsDevCatalogRefresh = (): Promise<ModelsDevCatalog | null> => {
  const now = Date.now();
  if (hasFreshModelsDevCatalog(now)) {
    return Promise.resolve(cachedModelsDevCatalog);
  }

  if (modelsDevRefreshInFlight) {
    return modelsDevRefreshInFlight;
  }

  if (cachedModelsDevUnavailableUntil > now) {
    return Promise.resolve(cachedModelsDevCatalog);
  }

  const refreshPromise: Promise<ModelsDevCatalog | null> = (async () => {
    try {
      const response = await fetchWithTimeout(
        'https://models.dev/api.json',
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
        },
        { timeoutMs: MODELS_DEV_TIMEOUT_MS, retries: 0 }
      );
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ModelsDevCatalog;
      cachedModelsDevCatalog = data;
      cachedModelsDevFetchedAt = Date.now();
      cachedModelsDevUnavailableUntil = 0;
      return data;
    } catch (error) {
      cachedModelsDevUnavailableUntil = Date.now() + MODELS_DEV_FAILURE_COOLDOWN_MS;
      factoryLogger.warn(
        `Failed to fetch models.dev catalog; disabling remote capability lookups for ${Math.trunc(MODELS_DEV_FAILURE_COOLDOWN_MS / 1000)}s`,
        error
      );
      if (cachedModelsDevCatalog) {
        return cachedModelsDevCatalog;
      }
      return null;
    } finally {
      if (modelsDevRefreshInFlight === refreshPromise) {
        modelsDevRefreshInFlight = null;
      }
    }
  })();

  modelsDevRefreshInFlight = refreshPromise;
  return refreshPromise;
};

export const refreshModelsDevCatalog = async (): Promise<ModelsDevCatalog | null> =>
  startModelsDevCatalogRefresh();

const scheduleModelsDevCatalogRefresh = () => {
  void startModelsDevCatalogRefresh();
};

const getModelsDevCatalogSnapshot = (): ModelsDevCatalog | null => {
  if (hasFreshModelsDevCatalog()) {
    return cachedModelsDevCatalog;
  }

  scheduleModelsDevCatalogRefresh();
  return cachedModelsDevCatalog;
};

export const fetchModelCapabilityFromDev = async (
  providerType: string,
  modelId: string
): Promise<ModelCapability | null> => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;
  if (isAcpProviderType(providerType)) return null;

  const catalog = getModelsDevCatalogSnapshot();
  return catalog ? lookupModelsDevModelCapability(catalog, providerType, trimmedModelId) : null;
};

export const resolveModelCapability = async (
  providerType: string,
  modelId: string,
  providerId?: string | null
): Promise<ModelCapability | null> => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  const modelOptions = getStoredProviderModelOptions(providerType, trimmedModelId, providerId);
  const baseCapability = await fetchModelCapabilityFromDev(providerType, trimmedModelId);

  return mergeModelCapability(baseCapability, providerType, trimmedModelId, modelOptions);
};

/**
 * Inject reasoning_content from reasoning content parts into each assistant
 * message's providerOptions, so that @ai-sdk/openai-compatible (and similar
 * providers) include it in the API request body. Needed for providers like MIMO
 * that require reasoning_content be passed back across all turns.
 */
export const injectReasoningContentIntoMessages = (
  messages: ModelMessage[],
): ModelMessage[] => {
  return messages.map(msg => {
    if (msg.role !== 'assistant') return msg;
    if (!Array.isArray(msg.content)) return msg;
    const reasoningParts = msg.content.filter(p => p.type === 'reasoning');
    if (reasoningParts.length === 0) return msg;
    const reasoningContent = reasoningParts.map(p => p.text).join('');
    return {
      ...msg,
      providerOptions: {
        ...msg.providerOptions,
        openaiCompatible: {
          ...(msg.providerOptions?.openaiCompatible ?? {}),
          reasoning_content: reasoningContent,
        },
      },
    };
  });
};

export const resetModelsDevCatalogCacheForTests = () => {
  cachedModelsDevCatalog = null;
  cachedModelsDevFetchedAt = 0;
  cachedModelsDevUnavailableUntil = 0;
  modelsDevRefreshInFlight = null;
};
