import type { ChatInvocationOptions } from '@iki/backend/types/electron_api';
import { clonePlainData } from '@iki/backend/utils/clone';
import type { ModelCapabilitySnapshot, Provider } from '@iki/backend/types/provider';

export type ComposerReadyProvider = {
  provider: Provider;
  model: string;
  modelCapability?: ModelCapabilitySnapshot | null;
};

/**
 * Invocation options minus `messages`: the Chat transport injects the
 * conversation history from the chat state at send time.
 */
export type ChatComposerInvocationBody = Omit<ChatInvocationOptions, 'messages'>;

export const createChatComposerStreamPayload = (params: {
  providerReady: ComposerReadyProvider;
  threadId: string;
  isAutoToolMode: boolean;
  selectedTools: string[];
  resolvedMcpServerIds: string[];
  isAutoSkillMode: boolean;
  selectedSkillIds: string[];
  /** Thread-level reasoning effort; empty string = provider default (omitted from payload). */
  reasoningEffort?: string;
  /** Thread-level agent personality; empty string = default (omitted from payload). */
  personality?: string;
  autonomous?: { maxIterations: number; continuePrompt?: string };
}): ChatComposerInvocationBody | null => {
  if (!params.threadId) {
    return null;
  }

  const reasoningEffort = params.reasoningEffort?.trim().toLowerCase();
  const personality = params.personality?.trim().toLowerCase();

  return {
    providerType: params.providerReady.provider.type,
    providerId: params.providerReady.provider.id,
    model: params.providerReady.model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(personality ? { personality } : {}),
    ...(params.providerReady.modelCapability &&
    (typeof params.providerReady.modelCapability.maxInputTokens === 'number' ||
      typeof params.providerReady.modelCapability.contextWindow === 'number' ||
      typeof params.providerReady.modelCapability.maxOutputTokens === 'number')
      ? { modelCapability: clonePlainData(params.providerReady.modelCapability) }
      : {}),
    tools: params.isAutoToolMode
      ? undefined
      : params.selectedTools.length > 0
        ? clonePlainData(params.selectedTools)
        : [],
    mcpServerIds: clonePlainData(params.resolvedMcpServerIds),
    skillMode: params.isAutoSkillMode ? 'auto' : 'manual',
    skillIds: params.isAutoSkillMode ? undefined : clonePlainData(params.selectedSkillIds),
    threadId: params.threadId,
    ...(params.autonomous ? { autonomous: params.autonomous } : {}),
  };
};
