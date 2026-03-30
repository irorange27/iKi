import { MemoryRetrievalAgent } from '../agents/memory_retrieval_agent';
import {
  createDefaultMemoryRetrievalRuntime,
  type MemoryRetrievalPlan,
  type MemoryRetrievalRuntime,
} from '../runtimes/memory_retrieval_runtime';

export type { MemoryRetrievalPlan, MemoryRetrievalRuntime };
export { MemoryRetrievalAgent } from '../agents/memory_retrieval_agent';
export { LlmMemoryRetrievalRuntime } from '../runtimes/memory_retrieval_runtime';

let defaultMemoryRetrievalAgent: MemoryRetrievalAgent | null = null;

const getDefaultMemoryRetrievalAgent = () => {
  if (!defaultMemoryRetrievalAgent) {
    defaultMemoryRetrievalAgent = new MemoryRetrievalAgent(createDefaultMemoryRetrievalRuntime());
  }
  return defaultMemoryRetrievalAgent;
};

export const createMemoryRetrievalAgent = (runtime: MemoryRetrievalRuntime) =>
  new MemoryRetrievalAgent(runtime);

export const planMemoryRetrieval = async (
  content: string
): Promise<MemoryRetrievalPlan | null> => getDefaultMemoryRetrievalAgent().run(content);

export const planMemoryRetrievalWithAgent = planMemoryRetrieval;
