import { generateText } from 'ai';

import {
  appendUserPromptToHistory,
  buildPromptContext,
  loadAgentConfig,
  validateAgentConfig,
} from '../agent/ai_sdk_runtime';
import type { AgentConfig, AgentResult, PartialAgentConfig } from '../agent/types';
import { createModel } from '../provider/llm/factory';

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
    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
    });

    return { response: result.text };
  }
}

export const createSimplePromptTextGenerator: PromptTextGeneratorFactory = (
  config?: PromptTextGeneratorConfig
) => new SimplePromptTextGenerator(config);
