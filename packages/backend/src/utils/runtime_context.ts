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

  registerChildRunAlias?: (parentRunId: string, childRunId: string) => () => void;

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

export type ConversationModelDefaults = {
  provider_type: string;
  provider_id: string | null;
  model: string;
};

export const resolveConversationModelDefaults = (args: {
  providerType?: string;
  providerId?: string;
  model?: string;
}): ConversationModelDefaults => {
  const runtimeModel = getToolRuntimeContext().conversationModel;
  const explicitProviderType = args.providerType?.trim() || '';
  const providerType = explicitProviderType || runtimeModel?.providerType?.trim() || '';
  const providerTypeMatchesRuntime =
    !explicitProviderType ||
    (runtimeModel?.providerType?.trim() || '') === explicitProviderType;

  const model =
    args.model?.trim() ||
    (providerTypeMatchesRuntime ? runtimeModel?.model?.trim() || '' : '');
  const providerId =
    args.providerId?.trim() ||
    (providerTypeMatchesRuntime ? runtimeModel?.providerId?.trim() || '' : '');

  if (!providerType) {
    throw new Error('providerType is required when no current chat model is available');
  }
  if (!model) {
    throw new Error('model is required when it cannot be inferred from the current chat');
  }

  return {
    provider_type: providerType,
    provider_id: providerId || null,
    model,
  };
};
