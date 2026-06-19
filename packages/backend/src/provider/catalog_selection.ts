import {
  buildTranscript,
  extractJsonCandidate,
  LlmCatalogSelectionRuntime,
  normalizeWhitespace,
  tryParseJson,
  type CatalogSelectionRequest,
  type CatalogSelectionRuntime,
  type SelectionMessage,
} from '../runtimes/catalog_selection_runtime';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';
import { getToolModel } from './tool_model';

export type { CatalogSelectionRequest as CatalogSelectorParams };
export type { CatalogSelectionRuntime, SelectionMessage };
export {
  LlmCatalogSelectionRuntime,
  buildTranscript,
  extractJsonCandidate,
  normalizeWhitespace,
  tryParseJson,
};

export const selectCatalogWithAgent = async <T>(
  params: CatalogSelectionRequest<T>
): Promise<string[]> => {
  if (params.availableCatalog.length === 0) return [];

  const runtime = new LlmCatalogSelectionRuntime({
    getToolModel,
    createGenerator: createSimplePromptTextGenerator,
  });
  return runtime.run(params);
};
