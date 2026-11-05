import { commitRows, patchRow, readRows, removeRow } from './collection';
import type { McpServer, McpServerInput, McpServerUpdate } from '@iki/core/types/mcp';
import { toIsoNow } from '@iki/core/utils/text';

// Legacy rows stored lists/maps as JSON strings and `enabled` as 0/1. The
// normalizers below accept both eras; every write stores the typed value.
type McpServerRow = Omit<McpServer, 'enabled'> & { enabled?: number | boolean };

const normalizeStringList = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.length > 0 && raw.every(item => typeof item === 'string')
    ? (raw as string[])
    : null;

const normalizeStringMap = (raw: unknown): Record<string, string> | null =>
  raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length > 0
    ? (raw as Record<string, string>)
    : null;

const normalizeRow = (row: McpServerRow): McpServer => ({
  ...row,
  enabled: Boolean(row.enabled),
  args: normalizeStringList(row.args),
  tool_allowlist: normalizeStringList(row.tool_allowlist),
  headers: normalizeStringMap(row.headers),
  env: normalizeStringMap(row.env),
});

export const listMcpServers = (): McpServer[] =>
  readRows<McpServerRow>('mcp_servers')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map(normalizeRow);

export const getMcpServer = (id: string): McpServer | null => {
  const row = readRows<McpServerRow>('mcp_servers').find(entry => entry.id === id);
  return row ? normalizeRow(row) : null;
};

export const addMcpServer = (input: McpServerInput & { id: string }): void => {
  const now = toIsoNow();
  const args = input.args ?? [];
  const allowlist = input.tool_allowlist ?? [];

  const row = {
    id: input.id,
    name: input.name,
    transport: input.transport,
    command: input.command ?? null,
    args: args.length > 0 ? args : null,
    cwd: input.cwd ?? null,
    env: input.env ?? null,
    base_url: input.base_url ?? null,
    headers: input.headers ?? null,
    auth_ref: input.auth_ref ?? null,
    enabled: input.enabled !== false,
    tool_allowlist: allowlist.length > 0 ? allowlist : null,
    approval_mode: input.approval_mode ?? null,
    created_at: now,
    updated_at: now,
    last_connected_at: null as string | null,
    last_error: null as string | null,
  };
  const rows = readRows<McpServerRow>('mcp_servers').filter(entry => entry.id !== input.id);
  rows.push(row as unknown as McpServerRow);
  commitRows('mcp_servers', rows);
};

/** Apply a partial update, encoding list/map fields for the row file. */
export const updateMcpServer = (id: string, updates: McpServerUpdate): McpServer | null => {
  if (Object.keys(updates).length === 0) return null;
  // McpServerUpdate cannot name the id — patchRow pins it regardless.
  if (!patchRow<McpServerRow>('mcp_servers', 'id', id, { ...updates })) return null;
  return getMcpServer(id);
};

export const deleteMcpServer = (id: string): void => {
  removeRow<McpServerRow>('mcp_servers', 'id', id);
};
