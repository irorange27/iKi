import { defaultToolRegistry } from '../core/tools';

export const DEFAULT_ALLOWED_TOOLS = ['web', 'fetch'];

const DEFAULT_TOOL_FALLBACK = ['web', 'fetch'];
const MCP_ALLOW_ALL_TOKEN = 'mcp:*';
const MCP_SERVER_PREFIX = 'mcp:server:';

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

export const readRequestedMcpServerIds = (payload: Record<string, unknown>): string[] => {
  const camelValue = payload.mcpServerIds;
  if (Array.isArray(camelValue)) {
    return normalizeStringArray(camelValue);
  }
  const snakeValue = payload.mcp_server_ids;
  if (Array.isArray(snakeValue)) {
    return normalizeStringArray(snakeValue);
  }
  return [];
};

export const resolveToolsForClient = (requested: unknown, allowedTools: string[]): string[] => {
  const allowed = new Set(normalizeStringArray(allowedTools));
  const cleanedRequested = normalizeStringArray(requested);

  if (cleanedRequested.length === 0) {
    return DEFAULT_TOOL_FALLBACK.filter(tool => allowed.has(tool));
  }

  return cleanedRequested.filter(tool => allowed.has(tool));
};

export const resolveMcpServerIdsForClient = (
  requested: unknown,
  allowedTools: string[]
): string[] => {
  const requestedIds = normalizeStringArray(requested);
  if (requestedIds.length === 0) return [];

  const { allowAll, serverIds } = resolveAllowedMcpServers(normalizeStringArray(allowedTools));
  if (allowAll) return requestedIds;

  return requestedIds.filter(serverId => serverIds.has(serverId));
};
