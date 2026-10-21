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
  isAutoSkillMode: boolean;
  selectedSkillIds: string[];
  /** Thread-level reasoning effort; empty string = provider default (omitted from payload). */
  reasoningEffort?: string;
  /** Thread-level agent personality; empty string = default (omitted from payload). */
  personality?: string;
  /**
   * Tool approval policy. The composer's "default" entry carries `askRisky`
   * rather than an empty string: an omitted policy made the backend log
   * `chat.stream.approval_policy degraded` and fall back to legacy flags on
   * every tool turn, so "the user picked nothing" silently differed from
   * "the user picked Ask first".
   */
  approvalPolicy?: string;
}): ChatComposerInvocationBody | null => {
  if (!params.threadId) {
    return null;
  }

  const reasoningEffort = params.reasoningEffort?.trim().toLowerCase();
  const personality = params.personality?.trim().toLowerCase();
  const approvalPolicy = params.approvalPolicy?.trim().toLowerCase();

  return {
    providerType: params.providerReady.provider.type,
    providerId: params.providerReady.provider.id,
    model: params.providerReady.model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(personality ? { personality } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(params.providerReady.modelCapability &&
    (typeof params.providerReady.modelCapability.maxInputTokens === 'number' ||
      typeof params.providerReady.modelCapability.contextWindow === 'number' ||
      typeof params.providerReady.modelCapability.maxOutputTokens === 'number')
      ? { modelCapability: clonePlainData(params.providerReady.modelCapability) }
      : {}),
    // Manual tool/MCP selection was removed with the composer selectors; the
    // composer always runs in auto tool mode (omit `tools` = agent decides).
    skillMode: params.isAutoSkillMode ? 'auto' : 'manual',
    skillIds: params.isAutoSkillMode ? undefined : clonePlainData(params.selectedSkillIds),
    threadId: params.threadId,
  };
};
