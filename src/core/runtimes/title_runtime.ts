import { SimpleAgent } from '../agent';

type ToolModelConfig = {
  providerType: string;
  model: string;
};

type AgentLike = Pick<SimpleAgent, 'generate'>;

export interface TitleRuntime {
  run(content: string): Promise<string | null>;
}

export type LlmTitleRuntimeDeps = {
  getToolModel: () => ToolModelConfig | null;
  createAgent: (config: ConstructorParameters<typeof SimpleAgent>[0]) => AgentLike;
};

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
        console.warn('No tool model available for title generation');
        return null;
      }

      const agent = this.deps.createAgent({
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

      const result = await agent.generate(text);
      return sanitizeGeneratedTitle(result.response || '');
    } catch (error) {
      console.error('Failed to generate title with agent:', error);
      return null;
    }
  }
}
