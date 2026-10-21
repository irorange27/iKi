import {
  buildTranscript,
  extractJsonCandidate,
  LlmCatalogSelectionRuntime,
  tryParseJson,
  type CatalogSelectionRequest,
  type SelectionMessage,
} from '../runtimes/catalog_selection_runtime';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';
import { normalizeWhitespace } from '@iki/backend/utils/text';
import { getToolModel } from './tool_model';

export type { CatalogSelectionRequest as CatalogSelectorParams };
export type { SelectionMessage };
export { normalizeWhitespace };
export {
  LlmCatalogSelectionRuntime,
  buildTranscript,
  extractJsonCandidate,
  tryParseJson,
};

export const selectCatalogWithAgent = async <T>(
  params: CatalogSelectionRequest<T>
): Promise<string[] | null> => {
  if (params.availableCatalog.length === 0) return null;

  const runtime = new LlmCatalogSelectionRuntime({
    getToolModel,
    createGenerator: createSimplePromptTextGenerator,
  });
  return runtime.run(params);
};
