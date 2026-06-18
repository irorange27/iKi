import { getAppConfig } from '@iki/backend/config';
import { defaultToolRegistry } from '@iki/core/tools';
import { applyToolApprovalPolicyList } from '@iki/core/utils/tool_approval';
import type { AffectState } from '@iki/core/emotion/affect_state';
import { selectToolsWithAgent } from '@iki/core/provider/tool_selection';
import type { ChatInputMessage } from './types';
import { toLlmChatMessages } from './ui_messages';

type ToolResolveMode = 'manual' | 'auto';
type ToolMetadata = ReturnType<typeof defaultToolRegistry.getToolMetadata>[number];
const AGENT_TOOL_NAME = 'agent';
const TODO_TOOL_NAME = 'todo';
const TODO_EXPLICIT_REQUEST_PATTERN =
  /\b(todo|to-do|checklist|plan|planning|progress|roadmap|milestone|step|steps|track)\b|待办|计划|规划|进度|路线图|里程碑|步骤|拆解/u;
const TODO_MULTI_STEP_PATTERN =
  /\b(first|then|after|before|finally|next|multi-step|several)\b|先|然后|再|接着|最后|分步|逐步|多步/u;
const TODO_COMPLEX_ACTION_PATTERN =
  /\b(inspect|implement|fix|debug|refactor|migrate|investigate|audit|review|analy[sz]e|design|integrate|wire|rewrite|update|patch|test|verify|trace)\b|检查|实现|修复|排查|重构|迁移|调查|审查|分析|设计|集成|接入|改写|更新|补丁|测试|验证|追踪/giu;

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

const countComplexTodoActionMatches = (value: string): number => {
  if (!value.trim()) return 0;
  return [...value.matchAll(TODO_COMPLEX_ACTION_PATTERN)].length;
};

const shouldRetainTodoTool = (messages: ChatInputMessage[], selectedTools: string[]): boolean => {
  if (!selectedTools.includes(TODO_TOOL_NAME)) return true;

  const nonTodoTools = selectedTools.filter(toolName => toolName !== TODO_TOOL_NAME);
  const llmMessages = toLlmChatMessages(messages);
  const latestUserText =
    [...llmMessages].reverse().find(message => message.role === 'user')?.content.trim() ?? '';

  if (!latestUserText) return false;
  if (TODO_EXPLICIT_REQUEST_PATTERN.test(latestUserText)) return true;

  const actionMatchCount = countComplexTodoActionMatches(latestUserText);
  const hasMultiStepSignal = TODO_MULTI_STEP_PATTERN.test(latestUserText);

  if (nonTodoTools.length >= 3) return true;
  if (nonTodoTools.length >= 2 && (actionMatchCount >= 1 || hasMultiStepSignal)) return true;
  if (nonTodoTools.length >= 1 && actionMatchCount >= 2) return true;

  return false;
};

const filterOvereagerTodoSelection = (
  messages: ChatInputMessage[],
  selectedTools: string[]
): string[] => {
  if (!Array.isArray(messages) || messages.length === 0) return selectedTools;
  if (shouldRetainTodoTool(messages, selectedTools)) return selectedTools;
  return selectedTools.filter(toolName => toolName !== TODO_TOOL_NAME);
};

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

  const filteredResolvedTools = filterOvereagerTodoSelection(
    params.inputMessages ?? [],
    resolvedTools
  );

  const filteredAgentTools = filterUnsupportedAgentSelection(filteredResolvedTools, catalog);

  return { explicitTools, resolvedTools: filteredAgentTools, mode };
};
