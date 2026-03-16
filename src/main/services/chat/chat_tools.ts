import { selectToolsWithAgent } from '../../../core/provider/tool_selection';
import { defaultToolRegistry } from '../../../core/tools';
import type { ChatInputMessage } from './chat_types';
import { toLlmChatMessages } from './chat_ui';

export const resolveToolNames = async (params: {
  inputMessages: ChatInputMessage[];
  tools?: string[];
}): Promise<{ explicitTools: string[]; resolvedTools: string[]; mode: 'manual' | 'auto' }> => {
  const explicitTools = Array.isArray(params.tools)
    ? params.tools.filter(
        (toolName): toolName is string => typeof toolName === 'string' && toolName.trim().length > 0
      )
    : [];

  let resolvedTools = explicitTools;
  const mode: 'manual' | 'auto' = explicitTools.length > 0 ? 'manual' : 'auto';

  if (resolvedTools.length === 0) {
    const availableTools = defaultToolRegistry
      .getToolMetadata()
      .map(t => ({ name: t.name, description: t.description }));
    resolvedTools = await selectToolsWithAgent({
      messages: toLlmChatMessages(params.inputMessages),
      availableTools,
    });
    if (resolvedTools.length > 0) {
      console.log('[Main] Auto-selected tools:', resolvedTools);
    }
  }

  return { explicitTools, resolvedTools, mode };
};

