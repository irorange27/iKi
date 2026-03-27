import { createSimpleConversationRunner, type ConversationRunner } from '../../../core/agent';

type CreateChatConversationRunnerParams = {
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enableTools: boolean;
  maxIterations?: number;
  maxTokens?: number;
};

export const createChatConversationRunner = (
  params: CreateChatConversationRunnerParams
): ConversationRunner =>
  createSimpleConversationRunner({
    enabled: true,
    providerType: params.providerType,
    ...(typeof params.providerId === 'string' && params.providerId.trim()
      ? { providerId: params.providerId.trim() }
      : {}),
    model: params.model,
    systemPrompt: params.systemPrompt,
    enableTools: params.enableTools,
    ...(typeof params.maxTokens === 'number' ? { maxTokens: params.maxTokens } : {}),
    maxIterations: params.maxIterations ?? 5,
  });
