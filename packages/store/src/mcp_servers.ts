import { commitRows, patchRow, readRows, removeRow } from './collection';
import type { McpServer, McpServerInput, McpServerUpdate } from '@iki/core/types/mcp';
import { toIsoNow } from '@iki/core/utils/text';
import { parseJsonStringArray, toStringArray } from '@iki/core/utils/json';

type McpServerRow = Omit<McpServer, 'enabled' | 'args' | 'tool_allowlist' | 'headers' | 'env'> & {
  enabled: number | boolean;
  args?: string | null;
  tool_allowlist?: string | null;
  headers?: string | null;
  env?: string | null;
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

const emptyToNull = (value: string[]): string[] | null => (value.length > 0 ? value : null);

const normalizeRow = (row: McpServerRow): McpServer => ({
  ...row,
  enabled: Boolean(row.enabled),
  args: emptyToNull(parseJsonStringArray(row.args)),
  tool_allowlist: emptyToNull(parseJsonStringArray(row.tool_allowlist)),
  headers: parseStringMap(row.headers) ?? null,
  env: parseStringMap(row.env) ?? null,
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
  const args = toStringArray(input.args);
  const allowlist = toStringArray(input.tool_allowlist);

  const row = {
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
    enabled: input.enabled !== false,
    tool_allowlist: allowlist.length > 0 ? JSON.stringify(allowlist) : null,
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
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id') continue;
    if (key === 'args' || key === 'tool_allowlist') {
      patch[key] = JSON.stringify(toStringArray(value));
      continue;
    }
    if ((key === 'headers' || key === 'env') && value && typeof value === 'object') {
      patch[key] = JSON.stringify(value);
      continue;
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return null;
  if (!patchRow<McpServerRow>('mcp_servers', 'id', id, patch)) return null;
  return getMcpServer(id);
};

export const deleteMcpServer = (id: string): void => {
  removeRow<McpServerRow>('mcp_servers', 'id', id);
};
