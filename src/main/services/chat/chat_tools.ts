import { defaultToolRegistry } from '../../../core/tools';
import { selectToolsWithAgent } from '../../../core/provider/tool_selection';
import type { ChatInputMessage } from './chat_types';
import { toLlmChatMessages } from './chat_ui';

type ToolResolveMode = 'manual' | 'auto';
type ToolMetadata = ReturnType<typeof defaultToolRegistry.getToolMetadata>[number];

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

const normalizeMcpServerIds = (serverIds: unknown[]): string[] => {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const serverId of serverIds) {
    if (typeof serverId !== 'string') continue;
    const trimmed = serverId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }

  return resolved;
};

const AUTO_BUILTIN_TOOL_ALLOWLIST = new Set<string>([
  'web',
  'fetch',
  'list_todo_lists',
  'read_todo_list',
  'write_todo_list',
]);

const isMcpToolFromAllowedServer = (
  tool: Pick<ToolMetadata, 'source'>,
  allowedServerIds: Set<string> | null
): boolean => {
  if (tool.source?.kind !== 'mcp') return true;
  if (!allowedServerIds) return false;
  const serverId = typeof tool.source?.id === 'string' ? tool.source.id.trim() : '';
  return serverId.length > 0 && allowedServerIds.has(serverId);
};

const getRegisteredToolMetadata = () => defaultToolRegistry.getToolMetadata();

const getAutoToolCatalog = (allowedMcpServerIds: Set<string> | null) =>
  getRegisteredToolMetadata()
    .filter(tool => {
      if (tool.source?.kind === 'mcp') {
        return tool.autoAllowed === true && isMcpToolFromAllowedServer(tool, allowedMcpServerIds);
      }
      return AUTO_BUILTIN_TOOL_ALLOWLIST.has(tool.name);
    })
    .map(tool => ({
      name: tool.name,
      description: tool.description,
    }));

const getAutoToolNames = (allowedMcpServerIds: Set<string> | null): string[] =>
  getAutoToolCatalog(allowedMcpServerIds).map(tool => tool.name);

const filterManualToolsByMcpServers = (
  toolNames: string[],
  allowedMcpServerIds: Set<string> | null
): string[] => {
  if (allowedMcpServerIds === null) return toolNames;

  return toolNames.filter(toolName => {
    const tool = defaultToolRegistry.get(toolName);
    if (!tool) return false;
    return isMcpToolFromAllowedServer(tool, allowedMcpServerIds);
  });
};

export const resolveToolNames = async (params: {
  tools?: string[];
  mcpServerIds?: string[];
  inputMessages?: ChatInputMessage[];
}): Promise<{ explicitTools: string[]; resolvedTools: string[]; mode: ToolResolveMode }> => {
  const hasExplicitToolsParam = Array.isArray(params.tools);
  const hasExplicitMcpServerIdsParam = Array.isArray(params.mcpServerIds);
  const explicitTools = hasExplicitToolsParam ? normalizeExplicitTools(params.tools) : [];
  const allowedMcpServerIds = hasExplicitMcpServerIdsParam
    ? new Set(normalizeMcpServerIds(params.mcpServerIds))
    : null;
  const mode: ToolResolveMode = hasExplicitToolsParam ? 'manual' : 'auto';

  // Default behavior: only expose low-risk tools in auto mode.
  // Explicit empty array disables tools.
  if (mode === 'manual') {
    return {
      explicitTools,
      resolvedTools: filterManualToolsByMcpServers(explicitTools, allowedMcpServerIds),
      mode,
    };
  }

  const catalog = getAutoToolCatalog(allowedMcpServerIds);
  const hasMessages = Array.isArray(params.inputMessages) && params.inputMessages.length > 0;
  const selection =
    catalog.length > 0 && hasMessages
      ? await selectToolsWithAgent({
          messages: toLlmChatMessages(params.inputMessages ?? []),
          availableTools: catalog,
        })
      : null;
  const resolvedTools =
    selection === null
      ? getAutoToolNames(allowedMcpServerIds)
      : selection.filter(toolName => catalog.some(tool => tool.name === toolName));

  return { explicitTools, resolvedTools, mode };
};
