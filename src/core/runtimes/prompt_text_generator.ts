import { SimpleAgent } from '../iki_simple_agent';
import type { AgentResult, PartialAgentConfig } from '../agent/types';

export type PromptTextGeneratorResult = Pick<AgentResult, 'response'>;

export interface PromptTextGenerator {
  generate(prompt: string): Promise<PromptTextGeneratorResult>;
}

export type PromptTextGeneratorConfig = PartialAgentConfig;

export type PromptTextGeneratorFactory = (
  config?: PromptTextGeneratorConfig
) => PromptTextGenerator;

export class SimplePromptTextGenerator implements PromptTextGenerator {
  private readonly agent: SimpleAgent;

  constructor(config?: PromptTextGeneratorConfig) {
    this.agent = new SimpleAgent(config);
  }

  generate(prompt: string): Promise<PromptTextGeneratorResult> {
    return this.agent.generate(prompt);
  }
}

export const createSimplePromptTextGenerator: PromptTextGeneratorFactory = (
  config?: PromptTextGeneratorConfig
) => new SimplePromptTextGenerator(config);
