import {
  createDefaultMemoryRetrievalRuntime,
  type MemoryRetrievalPlan,
  type MemoryRetrievalRuntime,
} from '../runtimes/memory_retrieval_runtime';

export type { MemoryRetrievalPlan, MemoryRetrievalRuntime };
export { LlmMemoryRetrievalRuntime } from '../runtimes/memory_retrieval_runtime';

let defaultMemoryRetrievalRuntime: MemoryRetrievalRuntime | null = null;

const getDefaultMemoryRetrievalRuntime = () => {
  if (!defaultMemoryRetrievalRuntime) {
    defaultMemoryRetrievalRuntime = createDefaultMemoryRetrievalRuntime();
  }
  return defaultMemoryRetrievalRuntime;
};

export const planMemoryRetrieval = async (
  content: string
): Promise<MemoryRetrievalPlan | null> => {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return getDefaultMemoryRetrievalRuntime().run(trimmed);
};
