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
  source: 'models.dev';
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
    source: 'models.dev',
  };
};
