import { AsyncLocalStorage } from 'node:async_hooks';

export type ToolRuntimeContext = {
  threadId?: string;
  availableSkillIds?: string[];
};

const storage = new AsyncLocalStorage<ToolRuntimeContext>();

export const getToolRuntimeContext = (): ToolRuntimeContext => storage.getStore() ?? {};

export const runWithToolRuntimeContext = async <T>(
  context: ToolRuntimeContext,
  fn: () => Promise<T>
): Promise<T> => {
  return await storage.run(context, fn);
};
