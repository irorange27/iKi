import type { ChatInvocationOptions } from '@iki/backend/types/electron_api';
import { clonePlainData } from '@iki/backend/utils/clone';
import type { ModelCapabilitySnapshot, Provider } from '@iki/backend/types/provider';

export type ComposerReadyProvider = {
  provider: Provider;
  model: string;
  modelCapability?: ModelCapabilitySnapshot | null;
};

export type ChatComposerInvocationBody = Omit<ChatInvocationOptions, 'messages'>;

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
