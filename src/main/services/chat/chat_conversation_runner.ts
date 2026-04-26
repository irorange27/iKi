import {
  composePrepareSteps,
  createPlanThenExecutePrepareStep,
  createSimpleConversationRunner,
  type ConversationRunner,
} from '../../../core/agent';
import { resolveChatToolMaxIterations } from './chat_constants';
import { createTodoPrepareStep } from './chat_todo_planning';

type CreateChatConversationRunnerParams = {
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enableTools: boolean;
  enabledTools?: string[];
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
    ...(params.enableTools
      ? {
          prepareStep: composePrepareSteps(
            createPlanThenExecutePrepareStep(params.enabledTools ?? []),
            createTodoPrepareStep(params.enabledTools ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ) as any,
        }
      : {}),
    ...(typeof params.maxTokens === 'number' ? { maxTokens: params.maxTokens } : {}),
    maxIterations: resolveChatToolMaxIterations(params.maxIterations),
  });
