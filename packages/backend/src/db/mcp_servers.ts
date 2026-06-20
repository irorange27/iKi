import { getDb } from './database';
import type { McpServer, McpServerInput, McpServerUpdate } from '@iki/backend/types/mcp';
import { toIsoNow } from '@iki/backend/utils/text';
import { buildSetClause } from './utils';

type McpServerRow = Omit<McpServer, 'enabled' | 'args' | 'tool_allowlist' | 'headers' | 'env'> & {
  enabled: number | boolean;
  args?: string | null;
  tool_allowlist?: string | null;
  headers?: string | null;
  env?: string | null;
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
};

const parseStringArray = (raw: string | null | undefined): string[] | null => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    const normalized = toStringArray(parsed);
    return normalized.length > 0 ? normalized : null;
  } catch {
    const normalized = toStringArray(raw);
    return normalized.length > 0 ? normalized : null;
  }
};

const parseStringMap = (raw: string | null | undefined): Record<string, string> | null => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string' || !key.trim()) continue;
      if (typeof value !== 'string') continue;
      cleaned[key.trim()] = value;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : null;
  } catch {
    return null;
  }
};

const normalizeRow = (row: McpServerRow): McpServer => ({
  ...row,
  enabled: Boolean(row.enabled),
  args: parseStringArray(row.args) ?? null,
  tool_allowlist: parseStringArray(row.tool_allowlist) ?? null,
  headers: parseStringMap(row.headers) ?? null,
  env: parseStringMap(row.env) ?? null,
});

export const listMcpServers = (): McpServer[] => {
  const rows = getDb()
    .prepare('SELECT * FROM mcp_servers ORDER BY updated_at DESC')
    .all() as McpServerRow[];
  return rows.map(normalizeRow);
};

export const getMcpServer = (id: string): McpServer | null => {
  const row = getDb()
    .prepare('SELECT * FROM mcp_servers WHERE id = ?')
    .get(id) as McpServerRow | undefined;
  if (!row) return null;
  return normalizeRow(row);
};

export const addMcpServer = (input: McpServerInput & { id: string }) => {
  const now = toIsoNow();
  const stmt = getDb().prepare(`
    INSERT INTO mcp_servers (
      id,
      name,
      transport,
      command,
      args,
      cwd,
      env,
      base_url,
      headers,
      auth_ref,
      enabled,
      tool_allowlist,
      approval_mode,
      created_at,
      updated_at,
      last_connected_at,
      last_error
    ) VALUES (
      @id,
      @name,
      @transport,
      @command,
      @args,
      @cwd,
      @env,
      @base_url,
      @headers,
      @auth_ref,
      @enabled,
      @tool_allowlist,
      @approval_mode,
      @created_at,
      @updated_at,
      @last_connected_at,
      @last_error
    )
  `);

  const args = toStringArray(input.args);
  const allowlist = toStringArray(input.tool_allowlist);

  const data: Record<string, unknown> = {
    id: input.id,
    name: input.name,
    transport: input.transport,
    command: input.command ?? null,
    args: args.length > 0 ? JSON.stringify(args) : null,
    cwd: input.cwd ?? null,
    env: input.env ? JSON.stringify(input.env) : null,
    base_url: input.base_url ?? null,
    headers: input.headers ? JSON.stringify(input.headers) : null,
    auth_ref: input.auth_ref ?? null,
    enabled: input.enabled ? 1 : 0,
    tool_allowlist: allowlist.length > 0 ? JSON.stringify(allowlist) : null,
    approval_mode: input.approval_mode ?? null,
    created_at: now,
    updated_at: now,
    last_connected_at: null,
    last_error: null,
  };

  return stmt.run(data);
};

const MCP_SERVER_COLUMNS = new Set([
  'name', 'transport', 'command', 'args', 'cwd', 'env', 'base_url',
  'headers', 'auth_ref', 'enabled', 'tool_allowlist', 'approval_mode',
  'last_connected_at', 'last_error',
]);

export const updateMcpServer = (id: string, updates: McpServerUpdate) => {
  const now = toIsoNow();
  const fields = buildSetClause(updates as Record<string, unknown>, MCP_SERVER_COLUMNS);

  if (!fields) return null;

  const stmt = getDb().prepare(`
    UPDATE mcp_servers
    SET ${fields}, updated_at = @updated_at
    WHERE id = @id
  `);

  const params: Record<string, unknown> = {
    ...updates,
    id,
    updated_at: now,
  };

  if (typeof updates.enabled === 'boolean') {
    params.enabled = updates.enabled ? 1 : 0;
  }
  if (Array.isArray(updates.args)) {
    params.args = JSON.stringify(toStringArray(updates.args));
  }
  if (Array.isArray(updates.tool_allowlist)) {
    const allowlist = toStringArray(updates.tool_allowlist);
    params.tool_allowlist = allowlist.length > 0 ? JSON.stringify(allowlist) : null;
  }
  if (updates.headers && typeof updates.headers === 'object') {
    params.headers = JSON.stringify(updates.headers);
  }
  if (updates.env && typeof updates.env === 'object') {
    params.env = JSON.stringify(updates.env);
  }

  return stmt.run(params);
};

export const deleteMcpServer = (id: string) => {
  return getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
};
