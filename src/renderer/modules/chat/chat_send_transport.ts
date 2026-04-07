import type { ChatInvocationOptions } from '../../../shared/types/electron_api';
import { clonePlainData } from '../../../shared/utils/clone';
import type { ModelCapabilitySnapshot, Provider } from '../../../shared/types/provider';

import type { PreparedMessageSend } from './chat_prepare_send';

export type ComposerReadyProvider = {
  provider: Provider;
  model: string;
  modelCapability?: ModelCapabilitySnapshot | null;
};

export const createChatComposerStreamPayload = (params: {
  providerReady: ComposerReadyProvider;
  preparedMessageSend: PreparedMessageSend;
  isAutoToolMode: boolean;
  selectedTools: string[];
  resolvedMcpServerIds: string[];
  isAutoSkillMode: boolean;
  selectedSkillIds: string[];
}): ChatInvocationOptions | null => {
  const transportMessages = clonePlainData(params.preparedMessageSend.messagesSnapshot);

  if (!Array.isArray(transportMessages) || transportMessages.length === 0) {
    return null;
  }

  return {
    providerType: params.providerReady.provider.type,
    providerId: params.providerReady.provider.id,
    model: params.providerReady.model,
    ...(params.providerReady.modelCapability &&
    (typeof params.providerReady.modelCapability.maxInputTokens === 'number' ||
      typeof params.providerReady.modelCapability.contextWindow === 'number' ||
      typeof params.providerReady.modelCapability.maxOutputTokens === 'number')
      ? { modelCapability: clonePlainData(params.providerReady.modelCapability) }
      : {}),
    messages: transportMessages,
    tools: params.isAutoToolMode
      ? undefined
      : params.selectedTools.length > 0
        ? clonePlainData(params.selectedTools)
        : [],
    mcpServerIds: clonePlainData(params.resolvedMcpServerIds),
    skillMode: params.isAutoSkillMode ? 'auto' : 'manual',
    skillIds: params.isAutoSkillMode ? undefined : clonePlainData(params.selectedSkillIds),
    threadId: params.preparedMessageSend.threadId,
  };
};
