import { createLogger } from '../logger';
import type { ToolModelConfig } from '../provider/tool_model';
import { type PromptTextGenerator, type PromptTextGeneratorConfig } from './prompt_text_generator';

export interface TitleRuntime {
  run(content: string): Promise<string | null>;
}

export type LlmTitleRuntimeDeps = {
  getToolModel: () => ToolModelConfig | null;
  createGenerator: (config?: PromptTextGeneratorConfig) => PromptTextGenerator;
};

const titleRuntimeLogger = createLogger({ module: 'title_runtime' });

export const sanitizeGeneratedTitle = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let title = trimmed.replace(/^["']|["']$/g, '');
  title = title.replace(/\n+/g, ' ').trim();

  if (title.length > 60) {
    title = `${title.slice(0, 57)}...`;
  }

  return title || null;
};

export class LlmTitleRuntime implements TitleRuntime {
  constructor(private readonly deps: LlmTitleRuntimeDeps) {}

  async run(content: string): Promise<string | null> {
    const text = content.trim();
    if (!text) return null;

    try {
      const toolModel = this.deps.getToolModel();
      if (!toolModel) {
        titleRuntimeLogger.event({
          level: 'warn',
          event: 'title.generate',
          outcome: 'skipped',
          message: 'Tool model unavailable; skipping title generation.',
        });
        return null;
      }

      const generator = this.deps.createGenerator({
        enabled: true,
        providerType: toolModel.providerType,
        model: toolModel.model,
        systemPrompt:
          'You are a helpful assistant that generates concise, descriptive titles for chat conversations.\nGenerate a short title (3-8 words) that captures the main topic or purpose of the conversation.\nThe title should be clear and informative, not generic.\nDo NOT use quotes around the title.\nDo NOT include any explanation, just output the title directly.',
        temperature: 0.1,
        maxTokens: 50,
        maxIterations: 1,
        enableTools: false,
        enableMemory: false,
      });

      const result = await generator.generate(text);
      return sanitizeGeneratedTitle(result.response || '');
    } catch (error) {
      titleRuntimeLogger.event({
        level: 'error',
        event: 'title.generate',
        outcome: 'failed',
        error,
      });
      return null;
    }
  }
}
