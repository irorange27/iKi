import { AsyncLocalStorage } from 'node:async_hooks';

import type { AgentTool } from '../agent/types';
import type { AgentRunTracker } from '../agent/run_tracker';

export type ToolRuntimeConversationModel = {
  providerType: string;
  providerId?: string;
  model: string;
  maxTokens?: number;
};

export type ToolRuntimeContext = {
  threadId?: string;
  runId?: string;
  runTracker?: Pick<AgentRunTracker, 'id' | 'recordChildRun'>;
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

export const bindToolRuntimeContextToGenerator = <T, TReturn = unknown, TNext = unknown>(
  context: ToolRuntimeContext,
  generator: AsyncGenerator<T, TReturn, TNext>
): AsyncGenerator<T, TReturn, TNext> => {
  const invoke = <K extends 'next' | 'return' | 'throw'>(
    method: K,
    value?: unknown
  ): Promise<IteratorResult<T, TReturn>> => {
    const target = generator[method] as
      | ((arg?: unknown) => Promise<IteratorResult<T, TReturn>>)
      | undefined;

    if (!target) {
      if (method === 'throw') {
        return Promise.reject(value);
      }
      return Promise.resolve({
        done: true,
        value: value as TReturn,
      });
    }

    return storage.run(context, () => target.call(generator, value));
  };

  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next(value?: TNext) {
      return invoke('next', value);
    },
    return(value?: TReturn) {
      return invoke('return', value);
    },
    throw(error?: unknown) {
      return invoke('throw', error);
    },
  } as AsyncGenerator<T, TReturn, TNext>;
};
