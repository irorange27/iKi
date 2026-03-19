import { createSimpleConversationRunner, type ConversationRunner } from '../../../core/agent';

type CreateChatConversationRunnerParams = {
  providerType: string;
  model: string;
  systemPrompt: string;
  enableTools: boolean;
  maxIterations?: number;
};

export const createChatConversationRunner = (
  params: CreateChatConversationRunnerParams
): ConversationRunner =>
  createSimpleConversationRunner({
    enabled: true,
    providerType: params.providerType,
    model: params.model,
    systemPrompt: params.systemPrompt,
    enableTools: params.enableTools,
    maxIterations: params.maxIterations ?? 5,
  });
