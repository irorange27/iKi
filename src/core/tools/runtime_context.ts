import { AsyncLocalStorage } from 'node:async_hooks';

import type { AgentTool } from '../agent/types';

export type ToolRuntimeConversationModel = {
  providerType: string;
  providerId?: string;
  model: string;
  maxTokens?: number;
};

export type ToolRuntimeContext = {
  threadId?: string;
  availableSkillIds?: string[];
  availableTools?: AgentTool[];
  conversationModel?: ToolRuntimeConversationModel;
  delegationDepth?: number;
};

const storage = new AsyncLocalStorage<ToolRuntimeContext>();

export const getToolRuntimeContext = (): ToolRuntimeContext => storage.getStore() ?? {};

export const runWithToolRuntimeContext = async <T>(
  context: ToolRuntimeContext,
  fn: () => Promise<T>
): Promise<T> => {
  return await storage.run(context, fn);
};
