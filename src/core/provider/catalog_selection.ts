import { CatalogSelectionAgent } from '../agents/catalog_selection_agent';
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
  CatalogSelectionAgent,
  LlmCatalogSelectionRuntime,
  buildTranscript,
  extractJsonCandidate,
  normalizeWhitespace,
  tryParseJson,
};

export const createCatalogSelectionAgent = (runtime: CatalogSelectionRuntime) =>
  new CatalogSelectionAgent(runtime);

export const selectCatalogWithAgent = async <T>(
  params: CatalogSelectionRequest<T>
): Promise<string[]> => {
  const agent = createCatalogSelectionAgent(
    new LlmCatalogSelectionRuntime({
      getToolModel,
      createGenerator: createSimplePromptTextGenerator,
    })
  );
  return agent.run(params);
};
