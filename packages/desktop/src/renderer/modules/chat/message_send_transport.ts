import type { ChatInvocationOptions } from '@iki/harness/types/electron_api';
import { toPlainData as clonePlainData } from '@iki/core/utils/plain_clone';
import type { ModelCapabilitySnapshot, Provider } from '@iki/core/types/provider';

type ComposerReadyProvider = {
  provider: Provider;
  model: string;
  modelCapability?: ModelCapabilitySnapshot | null;
};

type ChatComposerInvocationBody = Omit<ChatInvocationOptions, 'messages'>;

export const createChatComposerStreamPayload = (params: {
  providerReady: ComposerReadyProvider;
  threadId: string;
  isAutoSkillMode: boolean;
  selectedSkillIds: string[];
  
  reasoningEffort?: string;
  
  personality?: string;
  
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
    skillMode: params.isAutoSkillMode ? 'auto' : 'manual',
    skillIds: params.isAutoSkillMode ? undefined : clonePlainData(params.selectedSkillIds),
    threadId: params.threadId,
  };
};
