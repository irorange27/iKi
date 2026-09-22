import { AsyncLocalStorage } from 'node:async_hooks';

import type { AgentTool } from '@iki/backend/agent/types';
import type { AgentRun, AgentRunKind } from '@iki/backend/types/agent_run';

export type ToolRuntimeChildRunRecorder = {
  id: string;
  recordChildRun: (params: {
    childRunId: string;
    childKind: AgentRunKind;
    summary?: string;
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
  }) => AgentRun;
};

export type ToolRuntimeConversationModel = {
  providerType: string;
  providerId?: string;
  model: string;
  maxTokens?: number;
};

export type ToolRuntimeContext = {
  abortSignal?: AbortSignal;
  threadId?: string;
  runId?: string;
  runTracker?: ToolRuntimeChildRunRecorder;
  availableSkillIds?: string[];
  availableTools?: AgentTool[];
  conversationModel?: ToolRuntimeConversationModel;
  delegationDepth?: number;
  /**
   * Lazily-frozen workspace selection for this run. The first filesystem or
   * shell tool call resolves the thread's workspace from the database and
   * pins it here, so changing the thread's workspace mid-run cannot redirect
   * later tools in the same run to a different root. Boxed so "resolved to
   * no workspace" (selection: null) stays distinct from "not resolved yet".
   */
  workspaceSelectionBox?: { selection: unknown };
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
