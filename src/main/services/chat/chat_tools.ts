import { defaultToolRegistry } from '../../../core/tools';
import { selectToolsWithAgent } from '../../../core/provider/tool_selection';
import type { ChatInputMessage } from './chat_types';
import { toLlmChatMessages } from './chat_ui';

type ToolResolveMode = 'manual' | 'auto';

const normalizeExplicitTools = (tools: unknown[]): string[] => {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const toolName of tools) {
    if (typeof toolName !== 'string') continue;
    const trimmed = toolName.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    if (!defaultToolRegistry.get(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }

  return resolved;
};

const AUTO_TOOL_ALLOWLIST = new Set<string>(['web', 'fetch']);

const getAutoToolCatalog = () =>
  defaultToolRegistry
    .getToolMetadata()
    .filter(tool => AUTO_TOOL_ALLOWLIST.has(tool.name))
    .map(tool => ({
      name: tool.name,
      description: tool.description,
    }));

const getAutoToolNames = (): string[] => getAutoToolCatalog().map(tool => tool.name);

export const resolveToolNames = async (params: {
  tools?: string[];
  inputMessages?: ChatInputMessage[];
}): Promise<{ explicitTools: string[]; resolvedTools: string[]; mode: ToolResolveMode }> => {
  const hasExplicitToolsParam = Array.isArray(params.tools);
  const explicitTools = hasExplicitToolsParam ? normalizeExplicitTools(params.tools) : [];
  const mode: ToolResolveMode = hasExplicitToolsParam ? 'manual' : 'auto';

  // Default behavior: only expose low-risk tools in auto mode.
  // Explicit empty array disables tools.
  if (mode === 'manual') {
    return { explicitTools, resolvedTools: explicitTools, mode };
  }

  const catalog = getAutoToolCatalog();
  const hasMessages = Array.isArray(params.inputMessages) && params.inputMessages.length > 0;
  const selection =
    catalog.length > 0 && hasMessages
      ? await selectToolsWithAgent({
          messages: toLlmChatMessages(params.inputMessages ?? []),
          availableTools: catalog,
        })
      : null;
  const resolvedTools =
    selection === null ? getAutoToolNames() : selection.filter(tool => AUTO_TOOL_ALLOWLIST.has(tool));

  return { explicitTools, resolvedTools, mode };
};
