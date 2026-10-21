import { defaultToolRegistry } from '@iki/backend/tools';
import { decideToolApproval } from '@iki/backend/utils/action_risk';
import { createLogger } from '@iki/backend/logger';
import { selectToolsWithAgent } from '../provider/tool_selection';
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';
import { toLlmChatMessages } from '@iki/backend/message/ui_messages';

type ToolResolveMode = 'manual' | 'auto';
type ToolMetadata = ReturnType<typeof defaultToolRegistry.getToolMetadata>[number];
const toolGuardLogger = createLogger({ module: 'tool_guard' });
const AGENT_TOOL_NAME = 'agent';

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

const isMcpToolFromAllowedServer = (
  tool: Pick<ToolMetadata, 'source'>,
  allowedServerIds: Set<string> | null
): boolean => {
  if (tool.source?.kind !== 'mcp') return true;
  if (!allowedServerIds) return false;
  const serverId = typeof tool.source?.id === 'string' ? tool.source.id.trim() : '';
  return serverId.length > 0 && allowedServerIds.has(serverId);
};

const getRegisteredToolMetadata = (autoApproveToolRequests: boolean) =>
  defaultToolRegistry.getToolMetadata().map(tool => ({
    ...tool,
    needsApproval:
      decideToolApproval(tool, { autoApprove: autoApproveToolRequests }) === 'ask',
  }));

const getAutoToolCatalog = (
  autoApproveToolRequests: boolean,
  allowedMcpServerIds: Set<string> | null
) =>
  getRegisteredToolMetadata(autoApproveToolRequests)
    .filter(tool => {
      if (tool.source?.kind === 'mcp') {
        return tool.autoAllowed === true && isMcpToolFromAllowedServer(tool, allowedMcpServerIds);
      }
      return tool.autoAllowed === true;
    })
    .map(tool => ({
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      needsApproval: tool.needsApproval === true,
      source: tool.source,
    }));

const getAutoToolNames = (
  autoApproveToolRequests: boolean,
  allowedMcpServerIds: Set<string> | null
): string[] =>
  getAutoToolCatalog(autoApproveToolRequests, allowedMcpServerIds).map(tool => tool.name);

const filterUnsupportedAgentSelection = (
  selectedTools: string[],
  catalog: Array<Pick<ToolMetadata, 'name' | 'needsApproval'>>
): string[] => {
  if (!selectedTools.includes(AGENT_TOOL_NAME)) return selectedTools;

  const catalogByName = new Map(catalog.map(tool => [tool.name, tool]));
  const hasDelegableSiblingTool = selectedTools.some(toolName => {
    if (toolName === AGENT_TOOL_NAME) return false;
    const tool = catalogByName.get(toolName);
    return Boolean(tool) && tool.needsApproval !== true;
  });

  if (hasDelegableSiblingTool) return selectedTools;
  return selectedTools.filter(toolName => toolName !== AGENT_TOOL_NAME);
};

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
  autoApproveToolRequests?: boolean;
}): Promise<{ explicitTools: string[]; resolvedTools: string[]; mode: ToolResolveMode }> => {
  const autoApproveToolRequests = params.autoApproveToolRequests === true;
  const hasExplicitToolsParam = Array.isArray(params.tools);
  const hasExplicitMcpServerIdsParam = Array.isArray(params.mcpServerIds);
  const explicitTools = hasExplicitToolsParam ? normalizeExplicitTools(params.tools) : [];
  const allowedMcpServerIds = hasExplicitMcpServerIdsParam
    ? new Set(normalizeMcpServerIds(params.mcpServerIds))
    : null;
  const mode: ToolResolveMode = hasExplicitToolsParam ? 'manual' : 'auto';

  if (mode === 'manual') {
    return {
      explicitTools,
      resolvedTools: filterManualToolsByMcpServers(explicitTools, allowedMcpServerIds),
      mode,
    };
  }

  const catalog = getAutoToolCatalog(autoApproveToolRequests, allowedMcpServerIds);
  const hasMessages = Array.isArray(params.inputMessages) && params.inputMessages.length > 0;
  const selection =
    catalog.length > 0 && hasMessages
      ? await selectToolsWithAgent({
          messages: toLlmChatMessages(params.inputMessages ?? []),
          availableTools: catalog,
        })
      : null;

  if (selection === null && catalog.length > 0 && hasMessages) {
    toolGuardLogger.event({
      level: 'warn',
      event: 'tools.selection.fallback',
      outcome: 'degraded',
      message:
        'Tool router produced no selection (tool model unavailable or its call failed); exposing the full catalog for this turn.',
      data: { catalog_size: catalog.length },
    });
  }

  const resolvedTools =
    selection === null
      ? getAutoToolNames(autoApproveToolRequests, allowedMcpServerIds)
      : selection.filter(toolName => catalog.some(tool => tool.name === toolName));

  const filteredAgentTools = filterUnsupportedAgentSelection(resolvedTools, catalog);

  return { explicitTools, resolvedTools: filteredAgentTools, mode };
};
