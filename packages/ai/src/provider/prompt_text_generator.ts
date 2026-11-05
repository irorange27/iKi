import { appendUserPromptToHistory } from '@iki/ai/message/model_history';
import { buildPromptContext } from '@iki/ai/message/prompt_context';
import { generateChatWithModelMessages, getModelGenerationSettings } from '@iki/ai/provider/llm/factory';

type PromptTextGeneratorConfig = {
  enabled?: boolean;
  providerType: string;
  providerId?: string | null;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
  enableTools?: boolean;
  threadId?: string;
};

export const generatePromptText = async (
  config: PromptTextGeneratorConfig | undefined,
  prompt: string,
  abortSignal?: AbortSignal
): Promise<string> => {
  if (!config) throw new Error('generatePromptText requires a model config');
  // Same default temperature the old agent-config loader applied, so callers that
  // omit it keep the previous sampling behaviour.
  const resolved = { temperature: 0.1, maxTokens: 2000, ...config };

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
