import type { TaskAgent } from './task_agent';
import type {
  MemoryRetrievalPlan,
  MemoryRetrievalRuntime,
} from '../runtimes/memory_retrieval_runtime';

export class MemoryRetrievalAgent implements TaskAgent<string, MemoryRetrievalPlan | null> {
  constructor(private readonly runtime: MemoryRetrievalRuntime) {}

  async run(content: string): Promise<MemoryRetrievalPlan | null> {
    const text = content.trim();
    if (!text) return null;
    return this.runtime.run(text);
  }
}
