import { getProviders } from '../db/providers';
import { getConfig } from '../db/database';
import type { AppConfig } from '../../shared/types/config';
import { SimpleAgent } from '../agent';

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
    const config = getConfig('app_config') as AppConfig | null;
    const configuredModel = config?.toolModel?.model;

    const providers = getProviders();
    const enabledProviders = providers.filter(p => p.enabled);

    // If user configured a model, try to use it
    if (configuredModel) {
      for (const provider of enabledProviders) {
        try {
          const models = JSON.parse(provider.models || '[]');
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
          const models = JSON.parse(provider.models || '[]');
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
        const models = JSON.parse(provider.models || '[]');
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

/**
 * Generate a conversation title using Agent framework
 * @param conversationContent - The conversation content to generate title for
 * @returns Generated title or null if failed
 */
export const generateTitleWithAgent = async (
  conversationContent: string
): Promise<string | null> => {
  try {
    const toolModel = getToolModel();
    if (!toolModel) {
      console.warn('No tool model available for title generation');
      return null;
    }

    // Create agent with toolModel configuration
    const agent = new SimpleAgent({
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

    // Generate title using the conversation content
    const result = await agent.generate(conversationContent);

    if (result.response) {
      // Clean up the title: remove quotes, extra whitespace, etc.
      let title = result.response.trim();
      title = title.replace(/^["']|["']$/g, ''); // Remove surrounding quotes
      title = title.replace(/\n+/g, ' '); // Replace newlines with spaces
      title = title.trim();

      // Limit title length
      if (title.length > 60) {
        title = title.slice(0, 57) + '...';
      }

      return title || null;
    }

    return null;
  } catch (error) {
    console.error('Failed to generate title with agent:', error);
    return null;
  }
};
