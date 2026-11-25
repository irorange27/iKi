import fs from 'node:fs';
import path from 'node:path';
import type { McpServerInput, McpTransport } from '@iki/core/types/mcp';

type RawMcpJsonServer = {
  command?: unknown;
  args?: unknown;
  cwd?: unknown;
  env?: unknown;
  url?: unknown;
  baseUrl?: unknown;
  base_url?: unknown;
  headers?: unknown;
  transport?: unknown;
  type?: unknown;
  enabled?: unknown;
  disabled?: unknown;
};

const toStringArray = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const items = raw.filter((v): v is string => typeof v === 'string');
  return items.length > 0 ? items : undefined;
};

const toStringMap = (raw: unknown): Record<string, string> | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => [k, String(v)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/**
 * Parses standard Claude/Cursor-compatible `mcp.json` (`{ "mcpServers": { ... } }`)
 * into iKi `McpServerInput` records.
 */
export const parseMcpJsonConfig = (rawJson: string): McpServerInput[] => {
  const parsed = JSON.parse(rawJson) as { mcpServers?: Record<string, RawMcpJsonServer> };
  const serversObj = parsed?.mcpServers;
  if (!serversObj || typeof serversObj !== 'object' || Array.isArray(serversObj)) {
    throw new Error('Invalid mcp.json: expected a top-level "mcpServers" object.');
  }

  const out: McpServerInput[] = [];
  for (const [name, entry] of Object.entries(serversObj)) {
    const trimmedName = name.trim();
    if (!trimmedName || !entry || typeof entry !== 'object') continue;
    const enabled = entry.disabled === true ? false : entry.enabled !== false;
    const command = typeof entry.command === 'string' ? entry.command.trim() : '';
    const url =
      typeof entry.url === 'string'
        ? entry.url.trim()
        : typeof entry.baseUrl === 'string'
          ? entry.baseUrl.trim()
          : typeof entry.base_url === 'string'
            ? entry.base_url.trim()
            : '';

    if (command) {
      const args = toStringArray(entry.args);
      const env = toStringMap(entry.env);
      const cwd = typeof entry.cwd === 'string' && entry.cwd.trim() ? entry.cwd.trim() : undefined;
      out.push({
        name: trimmedName,
        transport: 'stdio',
        command,
        ...(args ? { args } : {}),
        ...(env ? { env } : {}),
        ...(cwd ? { cwd } : {}),
        enabled,
      });
      continue;
    }

    if (url) {
      const rawTransport = typeof entry.transport === 'string'
        ? entry.transport
        : typeof entry.type === 'string'
          ? entry.type
          : '';
      const transport: McpTransport = rawTransport === 'sse' ? 'sse' : 'streamable-http';
      const headers = toStringMap(entry.headers);
      out.push({
        name: trimmedName,
        transport,
        base_url: url,
        ...(headers ? { headers } : {}),
        enabled,
      });
    }
  }
  return out;
};

export const findDefaultMcpJsonPath = (params: {
  workspacePath?: string;
  dataDir: string;
}): string | null => {
  const candidates = [
    ...(params.workspacePath
      ? [
          path.join(params.workspacePath, '.mcp.json'),
          path.join(params.workspacePath, '.iki', 'mcp.json'),
        ]
      : []),
    path.join(params.dataDir, 'mcp.json'),
  ];
  return candidates.find(file => fs.existsSync(file)) ?? null;
};

export const readMcpJsonFile = (filePath: string): McpServerInput[] => {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  return parseMcpJsonConfig(raw);
};
