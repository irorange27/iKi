import { getAppConfig } from '../../../core/config';
import { defaultToolRegistry } from '../../../core/tools';
import { applyToolApprovalPolicyList } from '../../../shared/utils/tool_approval';
import type { AffectState } from '../../../core/emotion/affect_state';
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

const isMcpToolFromAllowedServer = (
  tool: Pick<ToolMetadata, 'source'>,
  allowedServerIds: Set<string> | null
): boolean => {
  if (tool.source?.kind !== 'mcp') return true;
  if (!allowedServerIds) return false;
  const serverId = typeof tool.source?.id === 'string' ? tool.source.id.trim() : '';
  return serverId.length > 0 && allowedServerIds.has(serverId);
};

const shouldAutoApproveToolRequests = () => {
  try {
    return getAppConfig()?.general?.autoApproveToolRequests === true;
  } catch {
    return false;
  }
};

const getRegisteredToolMetadata = () =>
  applyToolApprovalPolicyList(defaultToolRegistry.getToolMetadata(), {
    autoApproveToolRequests: shouldAutoApproveToolRequests(),
  });

const getAutoToolCatalog = (allowedMcpServerIds: Set<string> | null) =>
  getRegisteredToolMetadata()
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
  affectState?: AffectState | null;
}): Promise<{ explicitTools: string[]; resolvedTools: string[]; mode: ToolResolveMode }> => {
  const hasExplicitToolsParam = Array.isArray(params.tools);
  const hasExplicitMcpServerIdsParam = Array.isArray(params.mcpServerIds);
  const explicitTools = hasExplicitToolsParam ? normalizeExplicitTools(params.tools) : [];
  const allowedMcpServerIds = hasExplicitMcpServerIdsParam
    ? new Set(normalizeMcpServerIds(params.mcpServerIds))
    : null;
  const mode: ToolResolveMode = hasExplicitToolsParam ? 'manual' : 'auto';

  // Default behavior: expose every tool that has not explicitly opted out of auto mode.
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
          affectState: params.affectState,
        })
      : null;
  const resolvedTools =
    selection === null
      ? getAutoToolNames(allowedMcpServerIds)
      : selection.filter(toolName => catalog.some(tool => tool.name === toolName));

  return { explicitTools, resolvedTools, mode };
};
