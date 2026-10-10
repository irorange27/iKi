import {
  appendUserPromptToHistory,
  buildPromptContext,
} from '../provider/ai_sdk_runtime';
import {
  loadAgentConfig,
  validateAgentConfig,
} from '../agent/ai_sdk_config';
import type { AgentConfig, AgentResult, PartialAgentConfig } from '@iki/backend/agent/types';
import { generateChatWithModelMessages, getModelGenerationSettings } from '../provider/llm/factory';

export type PromptTextGeneratorResult = Pick<AgentResult, 'response'>;

export interface PromptTextGenerator {
  generate(prompt: string, abortSignal?: AbortSignal): Promise<PromptTextGeneratorResult>;
}

export type PromptTextGeneratorConfig = PartialAgentConfig & {
  /** Optional thread id — forwarded to Langfuse as sessionId. */
  threadId?: string;
};

export type PromptTextGeneratorFactory = (
  config?: PromptTextGeneratorConfig
) => PromptTextGenerator;

export class SimplePromptTextGenerator implements PromptTextGenerator {
  private readonly config: AgentConfig;
  private readonly threadId?: string;

  constructor(config?: PromptTextGeneratorConfig) {
    this.config = loadAgentConfig(config);
    this.threadId = config?.threadId;
  }

  async generate(prompt: string, abortSignal?: AbortSignal): Promise<PromptTextGeneratorResult> {
    validateAgentConfig(this.config);

    const history = appendUserPromptToHistory([], prompt);
    const { systemPrompt, messages } = buildPromptContext(this.config, history);
    // The factory entry picks the supply per the ADR 007 matrix (Pi for
    // eligible providers, AI SDK otherwise) and owns model lifecycle and
    // telemetry. The generator keeps its own system composition — passed as
    // the exact request system, replacing the factory's persona-led join.
    const generationSettings = getModelGenerationSettings({
      providerType: this.config.providerType,
      modelId: this.config.model,
      providerId: this.config.providerId,
      temperature: this.config.temperature,
    });
    const result = await generateChatWithModelMessages({
      providerType: this.config.providerType,
      providerId: this.config.providerId,
      modelId: this.config.model,
      messages,
      systemPromptOverride: systemPrompt,
      ...(typeof generationSettings.temperature === 'number'
        ? { temperature: generationSettings.temperature }
        : {}),
      ...(generationSettings.providerOptions
        ? { providerOptions: generationSettings.providerOptions }
        : {}),
      ...(typeof this.config.maxTokens === 'number' ? { maxOutputTokens: this.config.maxTokens } : {}),
      ...(this.threadId ? { threadId: this.threadId } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    return { response: result.text };
  }
}

export const createSimplePromptTextGenerator: PromptTextGeneratorFactory = (
  config?: PromptTextGeneratorConfig
) => new SimplePromptTextGenerator(config);
