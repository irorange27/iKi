import type { JSONValue } from '@ai-sdk/provider';

import type { ProviderModelOptions, ProviderModelOptionsMap } from '../types/provider';

const normalizeModelList = (models: unknown[]): string[] =>
  models
    .filter((model): model is string => typeof model === 'string')
    .map(model => model.trim())
    .filter(Boolean);

const MODELS_DEV_PROVIDER_KEY_MAP: Record<string, string> = {
  kimi: 'moonshotai',
  moonshot: 'moonshotai',
  zhipu: 'zhipuai',
  minimax: 'minimax-cn',
  deepseek: 'deepseek',
  openai: 'openai',
};

const normalizePositiveInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
};

const normalizeOptionalBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type ModelsDevLimitRecord = {
  context?: unknown;
  input?: unknown;
  output?: unknown;
};

type ModelsDevModelRecord = {
  name?: unknown;
  limit?: unknown;
  limits?: unknown;
  contextWindow?: unknown;
  context_window?: unknown;
  maxInputTokens?: unknown;
  max_input_tokens?: unknown;
  maxOutputTokens?: unknown;
  max_output_tokens?: unknown;
  tool_call?: unknown;
  supportsTools?: unknown;
  supports_tools?: unknown;
  reasoning?: unknown;
  supportsReasoning?: unknown;
  supports_reasoning?: unknown;
  vision?: unknown;
  supportsVision?: unknown;
  supports_vision?: unknown;
};

type ModelsDevProviderRecord = {
  models?: unknown;
};

export type ModelsDevCatalog = Record<string, ModelsDevProviderRecord>;

export type ModelCapability = {
  providerType: string;
  providerKey: string;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  supportsToolCalls: boolean | null;
  supportsReasoning: boolean | null;
  supportsVision?: boolean | null;
  source: 'models.dev' | 'provider';
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parseJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      return asRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  return asRecord(value);
};

const normalizeJsonValue = (value: unknown): JSONValue | undefined => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      const normalized = normalizeJsonValue(item);
      return normalized === undefined ? [] : [normalized];
    });
  }

  const record = asRecord(value);
  if (!record) return undefined;

  const normalizedEntries = Object.keys(record)
    .sort()
    .flatMap(key => {
      const normalized = normalizeJsonValue(record[key]);
      return normalized === undefined ? [] : [[key, normalized] as const];
    });

  return Object.fromEntries(normalizedEntries);
};

const normalizeJsonObject = (value: unknown): Record<string, JSONValue> | null => {
  const normalized = normalizeJsonValue(value);
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') {
    return null;
  }

  return normalized as Record<string, JSONValue>;
};

const getLimitRecord = (model: ModelsDevModelRecord): ModelsDevLimitRecord | null => {
  const direct = asRecord(model.limit);
  if (direct) return direct as ModelsDevLimitRecord;

  const alternate = asRecord(model.limits);
  if (alternate) return alternate as ModelsDevLimitRecord;

  return null;
};

const getProviderModelsRecord = (
  catalog: ModelsDevCatalog,
  providerType: string
): Record<string, ModelsDevModelRecord> | null => {
  const providerKey = getModelsDevProviderKey(providerType);
  const provider = asRecord(catalog[providerKey]) as ModelsDevProviderRecord | null;
  if (!provider) return null;

  const models = asRecord(provider.models);
  return models as Record<string, ModelsDevModelRecord> | null;
};

const normalizeProviderModelOptions = (value: unknown): ProviderModelOptions | null => {
  const record = asRecord(value);
  if (!record) return null;

  const normalized: ProviderModelOptions = {};
  const displayName = normalizeOptionalString(record.displayName ?? record.display_name);
  const contextWindow = normalizePositiveInteger(record.contextWindow ?? record.context_window);
  const maxInputTokens = normalizePositiveInteger(
    record.maxInputTokens ?? record.max_input_tokens
  );
  const maxOutputTokens = normalizePositiveInteger(
    record.maxOutputTokens ?? record.max_output_tokens
  );
  const supportsToolCalls =
    normalizeOptionalBoolean(record.supportsToolCalls) ??
    normalizeOptionalBoolean(record.supports_tools) ??
    normalizeOptionalBoolean(record.tool_call);
  const supportsReasoning =
    normalizeOptionalBoolean(record.supportsReasoning) ??
    normalizeOptionalBoolean(record.supports_reasoning) ??
    normalizeOptionalBoolean(record.reasoning);
  const supportsVision =
    normalizeOptionalBoolean(record.supportsVision) ??
    normalizeOptionalBoolean(record.supports_vision) ??
    normalizeOptionalBoolean(record.vision);
  const supportsStructuredOutputs =
    normalizeOptionalBoolean(record.supportsStructuredOutputs) ??
    normalizeOptionalBoolean(record.supports_structured_outputs) ??
    normalizeOptionalBoolean(record.structured_outputs);
  const providerOptions = normalizeJsonObject(record.providerOptions ?? record.provider_options);

  if (displayName) normalized.displayName = displayName;
  if (contextWindow !== null) normalized.contextWindow = contextWindow;
  if (maxInputTokens !== null) normalized.maxInputTokens = maxInputTokens;
  if (maxOutputTokens !== null) normalized.maxOutputTokens = maxOutputTokens;
  if (supportsToolCalls !== null) normalized.supportsToolCalls = supportsToolCalls;
  if (supportsReasoning !== null) normalized.supportsReasoning = supportsReasoning;
  if (supportsVision !== null) normalized.supportsVision = supportsVision;
  if (supportsStructuredOutputs !== null) {
    normalized.supportsStructuredOutputs = supportsStructuredOutputs;
  }
  if (providerOptions && Object.keys(providerOptions).length > 0) {
    normalized.providerOptions = providerOptions;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};

export const parseModelList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return normalizeModelList(value);
  }

  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return normalizeModelList(parsed);
    }
  } catch {
    return [];
  }

  return [];
};

export const parseProviderModelOptionsMap = (value: unknown): ProviderModelOptionsMap => {
  const record = parseJsonRecord(value);
  if (!record) return {};

  return Object.keys(record)
    .sort()
    .reduce<ProviderModelOptionsMap>((modelOptions, modelId) => {
      const trimmedModelId = modelId.trim();
      if (!trimmedModelId) return modelOptions;

      const normalized = normalizeProviderModelOptions(record[modelId]);
      if (normalized) {
        modelOptions[trimmedModelId] = normalized;
      }

      return modelOptions;
    }, {});
};

export const getProviderModelOptions = (
  modelOptions: ProviderModelOptionsMap,
  modelId: string
): ProviderModelOptions | null => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  return normalizeProviderModelOptions(modelOptions[trimmedModelId]) ?? null;
};

export const pruneProviderModelOptionsMap = (
  modelOptions: ProviderModelOptionsMap,
  modelIds: string[]
): ProviderModelOptionsMap => {
  const allowedModelIds = new Set(modelIds.map(modelId => modelId.trim()).filter(Boolean));
  if (allowedModelIds.size === 0) return {};

  return Object.keys(modelOptions)
    .sort()
    .reduce<ProviderModelOptionsMap>((trimmedOptions, modelId) => {
      const trimmedModelId = modelId.trim();
      if (!trimmedModelId || !allowedModelIds.has(trimmedModelId)) {
        return trimmedOptions;
      }

      const normalized = normalizeProviderModelOptions(modelOptions[modelId]);
      if (normalized) {
        trimmedOptions[trimmedModelId] = normalized;
      }

      return trimmedOptions;
    }, {});
};

export const serializeProviderModelOptionsMap = (
  value: unknown,
  modelIds?: string[]
): string => {
  const parsed = parseProviderModelOptionsMap(value);
  const normalized =
    Array.isArray(modelIds) && modelIds.length > 0
      ? pruneProviderModelOptionsMap(parsed, modelIds)
      : pruneProviderModelOptionsMap(parsed, Object.keys(parsed));

  return JSON.stringify(normalized);
};

export const getModelsDevProviderKey = (providerType: string): string => {
  const normalized = providerType.trim().toLowerCase();
  return MODELS_DEV_PROVIDER_KEY_MAP[normalized] || normalized;
};

export const listModelsDevProviderModels = (
  catalog: ModelsDevCatalog,
  providerType: string
): string[] => {
  const models = getProviderModelsRecord(catalog, providerType);
  if (!models) return [];
  return Object.keys(models).filter(Boolean);
};

export const lookupModelsDevModelCapability = (
  catalog: ModelsDevCatalog,
  providerType: string,
  modelId: string
): ModelCapability | null => {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  const models = getProviderModelsRecord(catalog, providerType);
  if (!models) return null;

  const model = models[trimmedModelId];
  if (!model) return null;

  const limit = getLimitRecord(model);
  const contextWindow =
    normalizePositiveInteger(limit?.context) ??
    normalizePositiveInteger(model.contextWindow) ??
    normalizePositiveInteger(model.context_window);
  const maxInputTokens =
    normalizePositiveInteger(limit?.input) ??
    normalizePositiveInteger(model.maxInputTokens) ??
    normalizePositiveInteger(model.max_input_tokens) ??
    contextWindow;
  const maxOutputTokens =
    normalizePositiveInteger(limit?.output) ??
    normalizePositiveInteger(model.maxOutputTokens) ??
    normalizePositiveInteger(model.max_output_tokens);
  const supportsToolCalls =
    normalizeOptionalBoolean(model.tool_call) ??
    normalizeOptionalBoolean(model.supportsTools) ??
    normalizeOptionalBoolean(model.supports_tools);
  const supportsReasoning =
    normalizeOptionalBoolean(model.reasoning) ??
    normalizeOptionalBoolean(model.supportsReasoning) ??
    normalizeOptionalBoolean(model.supports_reasoning);
  const supportsVision =
    normalizeOptionalBoolean(model.vision) ??
    normalizeOptionalBoolean(model.supportsVision) ??
    normalizeOptionalBoolean(model.supports_vision);

  return {
    providerType,
    providerKey: getModelsDevProviderKey(providerType),
    modelId: trimmedModelId,
    displayName:
      typeof model.name === 'string' && model.name.trim().length > 0
        ? model.name.trim()
        : trimmedModelId,
    contextWindow,
    maxInputTokens,
    maxOutputTokens,
    supportsToolCalls,
    supportsReasoning,
    ...(supportsVision !== null ? { supportsVision } : {}),
    source: 'models.dev',
  };
};

export const createModelCapabilityFromProviderModelOptions = (
  providerType: string,
  modelId: string,
  options: ProviderModelOptions | null | undefined
): ModelCapability | null => {
  const normalized = normalizeProviderModelOptions(options);
  if (!normalized) return null;

  return {
    providerType,
    providerKey: getModelsDevProviderKey(providerType),
    modelId: modelId.trim(),
    displayName: normalized.displayName || modelId.trim(),
    contextWindow: normalized.contextWindow ?? null,
    maxInputTokens: normalized.maxInputTokens ?? normalized.contextWindow ?? null,
    maxOutputTokens: normalized.maxOutputTokens ?? null,
    supportsToolCalls: normalized.supportsToolCalls ?? null,
    supportsReasoning: normalized.supportsReasoning ?? null,
    ...(normalized.supportsVision !== undefined
      ? { supportsVision: normalized.supportsVision ?? null }
      : {}),
    source: 'provider',
  };
};

export const mergeModelCapability = (
  baseCapability: ModelCapability | null,
  providerType: string,
  modelId: string,
  modelOptions: ProviderModelOptions | null | undefined
): ModelCapability | null => {
  const providerCapability = createModelCapabilityFromProviderModelOptions(
    providerType,
    modelId,
    modelOptions
  );

  if (!baseCapability) return providerCapability;
  if (!providerCapability) return baseCapability;

  const supportsVision =
    providerCapability.supportsVision !== undefined
      ? providerCapability.supportsVision
      : baseCapability.supportsVision;

  return {
    ...baseCapability,
    displayName: providerCapability.displayName || baseCapability.displayName,
    contextWindow: providerCapability.contextWindow ?? baseCapability.contextWindow,
    maxInputTokens: providerCapability.maxInputTokens ?? baseCapability.maxInputTokens,
    maxOutputTokens: providerCapability.maxOutputTokens ?? baseCapability.maxOutputTokens,
    supportsToolCalls: providerCapability.supportsToolCalls ?? baseCapability.supportsToolCalls,
    supportsReasoning: providerCapability.supportsReasoning ?? baseCapability.supportsReasoning,
    ...(supportsVision !== undefined ? { supportsVision } : {}),
    source: 'provider',
  };
};
