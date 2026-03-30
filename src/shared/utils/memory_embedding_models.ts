import type { Provider } from '../types/provider';
import type { ProviderModelOptions } from '../types/provider';
import { parseModelList, parseProviderModelOptionsMap } from './provider_models';

export const DEFAULT_MEMORY_EMBEDDING_MODEL = 'text-embedding-3-small';

const EMBEDDING_MODEL_PATTERN = /(?:^|[-_./])(embed|embedding)(?:[-_./]|$)/i;

const uniquePreserveOrder = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
};

export const isLikelyEmbeddingModel = (
  modelId: string,
  options?: ProviderModelOptions | null
): boolean => {
  if (options?.supportsEmbeddings === true) return true;
  if (options?.supportsEmbeddings === false) return false;
  return EMBEDDING_MODEL_PATTERN.test(modelId);
};

export const listProviderEmbeddingModels = (provider: Pick<Provider, 'type' | 'models' | 'model_options'>): string[] => {
  const models = parseModelList(provider.models);
  const modelOptionsMap = parseProviderModelOptionsMap(provider.model_options);
  const embeddingModels = models.filter(model => isLikelyEmbeddingModel(model, modelOptionsMap[model]));

  if (provider.type === 'openai') {
    return uniquePreserveOrder([DEFAULT_MEMORY_EMBEDDING_MODEL, ...embeddingModels]);
  }

  return uniquePreserveOrder(embeddingModels);
};
