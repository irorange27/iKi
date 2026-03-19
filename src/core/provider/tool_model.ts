import { getProviders } from '../db/providers';
import { getAppConfig } from '../config';
import { SimpleAgent } from '../agent';
import { TitleAgent } from '../agents/title_agent';
import {
  LlmTitleRuntime,
  type TitleRuntime,
} from '../runtimes/title_runtime';
import { parseModelList } from '../../shared/utils/provider_models';

export interface ToolModelConfig {
  providerType: string;
  model: string;
}

/**
 * Get Tool Model configuration with auto-detection
 * Priority: User config → Auto-detect recommended models
 */
export const getToolModel = (): ToolModelConfig | null => {
  try {
    // Get user config
    const config = getAppConfig();
    const configuredModel = config?.toolModel?.model;

    const providers = getProviders();
    const enabledProviders = providers.filter(p => p.enabled);

    // If user configured a model, try to use it
    if (configuredModel) {
      for (const provider of enabledProviders) {
        try {
          const models = parseModelList(provider.models);
          if (models.includes(configuredModel)) {
            return { providerType: provider.type, model: configuredModel };
          }
        } catch {
          continue;
        }
      }
    }

    // Auto-detect: find the fastest recommended model
    // Priority order: OpenAI → Anthropic → Google → DeepSeek → others
    const priorityOrder = ['openai', 'anthropic', 'google', 'deepseek'];
    const recommendedModels = [
      'gpt-4o-mini',
      'gpt-4o',
      'claude-3-5-haiku',
      'claude-3-haiku',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'deepseek-chat',
    ];

    // Try to find recommended model in priority order
    for (const providerType of priorityOrder) {
      const provider = enabledProviders.find(p => p.type === providerType);
      if (provider) {
        try {
          const models = parseModelList(provider.models);
          // Filter out reasoning models
          const validModels = models.filter((m: string) => {
            const lower = m.toLowerCase();
            return !lower.includes('o1') && !lower.includes('o3') && !lower.includes('thinking');
          });

          // Find first recommended model
          for (const recommended of recommendedModels) {
            if (validModels.includes(recommended)) {
              return { providerType, model: recommended };
            }
          }

          // If no recommended model, use first valid model
          if (validModels.length > 0) {
            return { providerType, model: validModels[0] };
          }
        } catch {
          continue;
        }
      }
    }

    // Fallback: use first enabled provider's first model
    if (enabledProviders.length > 0) {
      const provider = enabledProviders[0];
      try {
        const models = parseModelList(provider.models);
        if (models.length > 0) {
          return { providerType: provider.type, model: models[0] };
        }
      } catch {
        // Ignore
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to get tool model:', error);
    return null;
  }
};

export type { TitleRuntime };
export { TitleAgent, LlmTitleRuntime };

export const createTitleAgent = (runtime: TitleRuntime) => new TitleAgent(runtime);

export const generateTitle = async (
  conversationContent: string
): Promise<string | null> => {
  const agent = createTitleAgent(
    new LlmTitleRuntime({
      getToolModel,
      createAgent: config => new SimpleAgent(config),
    })
  );
  return agent.run(conversationContent);
};

export const generateTitleWithAgent = generateTitle;
