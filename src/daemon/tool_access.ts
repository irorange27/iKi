import { defaultToolRegistry } from '../core/tools';

const MCP_ALLOW_ALL_TOKEN = 'mcp:*';
const MCP_SERVER_PREFIX = 'mcp:server:';
const FALLBACK_DEFAULT_BUILTIN_TOOL_NAMES = [
  'web',
  'fetch',
  'list_dir',
  'read_file',
  'write_file',
  'delete_file',
  'shell',
  'list_personal_skills',
  'read_personal_skill',
  'write_personal_skill',
  'delete_personal_skill',
  'todo',
  'list_todo_lists',
  'read_todo_list',
  'write_todo_list',
  'delete_todo_list',
];

const normalizeStringArray = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const entry of input) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }

  return resolved;
};

const getBuiltinToolOrder = (toolName: string): number => {
  if (toolName === 'web' || toolName === 'fetch') return 0;
  if (
    toolName === 'list_dir' ||
    toolName === 'read_file' ||
    toolName === 'write_file' ||
    toolName === 'delete_file'
  ) {
    return 1;
  }
  if (toolName === 'shell') return 2;
  if (toolName.startsWith('list_personal_skill') || toolName.startsWith('read_personal_skill')) {
    return 3;
  }
  if (toolName.startsWith('write_personal_skill') || toolName.startsWith('delete_personal_skill')) {
    return 4;
  }
  if (toolName === 'todo') return 5;
  if (toolName.startsWith('list_todo_list') || toolName.startsWith('read_todo_list')) {
    return 6;
  }
  if (toolName.startsWith('write_todo_list') || toolName.startsWith('delete_todo_list')) {
    return 7;
  }
  return 8;
};

const getDefaultBuiltinToolNames = (): string[] => {
  const registered = normalizeStringArray(
    defaultToolRegistry
      .getAll()
      .filter(tool => tool.autoAllowed === true && tool.source?.kind !== 'mcp')
      .map(tool => tool.name)
  ).sort((left, right) => {
    const orderDiff = getBuiltinToolOrder(left) - getBuiltinToolOrder(right);
    if (orderDiff !== 0) return orderDiff;
    return left.localeCompare(right);
  });

  return registered.length > 0 ? registered : [...FALLBACK_DEFAULT_BUILTIN_TOOL_NAMES];
};

export const getDefaultAllowedTools = (): string[] => [
  ...getDefaultBuiltinToolNames(),
  MCP_ALLOW_ALL_TOKEN,
];

const resolveAllowedMcpServers = (
  allowedTools: string[]
): { allowAll: boolean; serverIds: Set<string> } => {
  let allowAll = false;
  const serverIds = new Set<string>();

  for (const token of allowedTools) {
    const normalized = token.trim();
    if (!normalized) continue;

    if (normalized === MCP_ALLOW_ALL_TOKEN) {
      allowAll = true;
      continue;
    }

    if (normalized.startsWith(MCP_SERVER_PREFIX)) {
      const serverId = normalized.slice(MCP_SERVER_PREFIX.length).trim();
      if (serverId) {
        serverIds.add(serverId);
      }
      continue;
    }

    const tool = defaultToolRegistry.get(normalized);
    if (!tool || tool.source?.kind !== 'mcp') continue;
    const serverId = typeof tool.source.id === 'string' ? tool.source.id.trim() : '';
    if (serverId) {
      serverIds.add(serverId);
    }
  }

  return { allowAll, serverIds };
};

const getRegisteredMcpServerIds = (): string[] =>
  normalizeStringArray(
    defaultToolRegistry
      .getAll()
      .map(tool =>
        tool.source?.kind === 'mcp' && typeof tool.source.id === 'string' ? tool.source.id : null
      )
  );

const isToolAllowedForClient = (toolName: string, allowedTools: string[]): boolean => {
  const normalizedAllowedTools = normalizeStringArray(allowedTools);
  const allowed = new Set(normalizedAllowedTools);
  if (allowed.has(toolName)) return true;

  const tool = defaultToolRegistry.get(toolName);
  if (!tool || tool.source?.kind !== 'mcp') return false;

  const serverId = typeof tool.source.id === 'string' ? tool.source.id.trim() : '';
  if (!serverId) return false;

  const { allowAll, serverIds } = resolveAllowedMcpServers(normalizedAllowedTools);
  return allowAll || serverIds.has(serverId);
};

export const readRequestedMcpServerIds = (
  payload: Record<string, unknown>
): string[] | undefined => {
  if (Object.prototype.hasOwnProperty.call(payload, 'mcpServerIds')) {
    return normalizeStringArray(payload.mcpServerIds);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'mcp_server_ids')) {
    return normalizeStringArray(payload.mcp_server_ids);
  }
  return undefined;
};

export const resolveToolsForClient = (requested: unknown, allowedTools: string[]): string[] => {
  if (Array.isArray(requested)) {
    const cleanedRequested = normalizeStringArray(requested);
    if (cleanedRequested.length === 0) {
      return [];
    }
    return cleanedRequested.filter(tool => isToolAllowedForClient(tool, allowedTools));
  }

  if (requested !== undefined && requested !== null) {
    return [];
  }

  return getDefaultBuiltinToolNames().filter(tool => isToolAllowedForClient(tool, allowedTools));
};

export const resolveMcpServerIdsForClient = (
  requested: unknown,
  allowedTools: string[]
): string[] => {
  const { allowAll, serverIds } = resolveAllowedMcpServers(normalizeStringArray(allowedTools));

  if (Array.isArray(requested)) {
    const requestedIds = normalizeStringArray(requested);
    if (requestedIds.length === 0) return [];
    if (allowAll) return requestedIds;
    return requestedIds.filter(serverId => serverIds.has(serverId));
  }

  if (requested !== undefined && requested !== null) {
    return [];
  }

  if (allowAll) {
    return getRegisteredMcpServerIds();
  }

  return Array.from(serverIds).sort((left, right) => left.localeCompare(right));
};
