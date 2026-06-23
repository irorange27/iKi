import { generateText } from 'ai';

import { langfuseTelemetry } from '@iki/backend/observability/langfuse';
import {
  appendUserPromptToHistory,
  buildPromptContext,
} from '../provider/ai_sdk_runtime';
import {
  loadAgentConfig,
  validateAgentConfig,
} from '../agent/ai_sdk_config';
import type { AgentConfig, AgentResult, PartialAgentConfig } from '@iki/backend/agent/types';
import {
  createModel,
  disposeLanguageModel,
  getModelGenerationSettings,
} from '../provider/llm/factory';

export type PromptTextGeneratorResult = Pick<AgentResult, 'response'>;

export interface PromptTextGenerator {
  generate(prompt: string): Promise<PromptTextGeneratorResult>;
}

export type PromptTextGeneratorConfig = PartialAgentConfig;

export type PromptTextGeneratorFactory = (
  config?: PromptTextGeneratorConfig
) => PromptTextGenerator;

export class SimplePromptTextGenerator implements PromptTextGenerator {
  private readonly config: AgentConfig;

  constructor(config?: PromptTextGeneratorConfig) {
    this.config = loadAgentConfig(config);
  }

  async generate(prompt: string): Promise<PromptTextGeneratorResult> {
    validateAgentConfig(this.config);

    const history = appendUserPromptToHistory([], prompt);
    const { systemPrompt, messages } = buildPromptContext(this.config, history);
    const model = createModel(this.config.providerType, this.config.model, this.config.providerId);
    try {
      const telemetry = langfuseTelemetry('prompt.generate', {
        provider: this.config.providerType,
        providerId: this.config.providerId,
        model: this.config.model,
      });
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        ...getModelGenerationSettings({
          providerType: this.config.providerType,
          modelId: this.config.model,
          providerId: this.config.providerId,
          temperature: this.config.temperature,
        }),
        maxOutputTokens: this.config.maxTokens,
        ...(telemetry ? { experimental_telemetry: telemetry } : {}),
      });

      return { response: result.text };
    } finally {
      disposeLanguageModel(model);
    }
  }
}

export const createSimplePromptTextGenerator: PromptTextGeneratorFactory = (
  config?: PromptTextGeneratorConfig
) => new SimplePromptTextGenerator(config);
