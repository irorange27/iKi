import { appendUserPromptToHistory } from '@iki/backend/message/model_history';
import { buildPromptContext } from '@iki/backend/message/prompt_context';
import { loadAgentConfig, validateAgentConfig } from '../agent/config';
import type { PartialAgentConfig } from '@iki/backend/agent/types';
import { generateChatWithModelMessages, getModelGenerationSettings } from '../provider/llm/factory';

export type PromptTextGeneratorConfig = PartialAgentConfig & {
  threadId?: string;
};

export const generatePromptText = async (
  config: PromptTextGeneratorConfig | undefined,
  prompt: string,
  abortSignal?: AbortSignal
): Promise<string> => {
  const resolved = loadAgentConfig(config);
  validateAgentConfig(resolved);

  const history = appendUserPromptToHistory([], prompt);
  const { systemPrompt, messages } = buildPromptContext(resolved, history);

  const generationSettings = getModelGenerationSettings({
    providerType: resolved.providerType,
    modelId: resolved.model,
    providerId: resolved.providerId,
    temperature: resolved.temperature,
  });

  const result = await generateChatWithModelMessages({
    providerType: resolved.providerType,
    providerId: resolved.providerId,
    modelId: resolved.model,
    messages,
    auxSystemInstruction: systemPrompt,
    ...(typeof generationSettings.temperature === 'number'
      ? { temperature: generationSettings.temperature }
      : {}),
    ...(generationSettings.providerOptions
      ? { providerOptions: generationSettings.providerOptions }
      : {}),
    ...(typeof resolved.maxTokens === 'number' ? { maxOutputTokens: resolved.maxTokens } : {}),
    ...(config?.threadId ? { threadId: config.threadId } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  });

  return result.text;
};
