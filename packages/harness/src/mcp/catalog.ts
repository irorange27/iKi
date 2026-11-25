import { sanitizeJsIdentifier, type PtcMcpServerDescriptor } from '@iki/harness/tools';
import type {
  McpApprovalMode,
  McpServer,
  McpServerStatus,
  McpToolCatalogItem,
} from '@iki/core/types/mcp';

export type McpToolCandidate = {
  server: McpServer;
  tool: McpToolCatalogItem;
};

export type McpToolRegistration = McpToolCandidate & {
  internalName: string;
};

export type McpCatalogConnection = {
  server: McpServer;
  status: McpServerStatus;
  tools: McpToolCatalogItem[];
};

const MAX_SCHEMA_BYTES = 20000;
const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_NAME_PREFIX = 'mcp_';
const TOOL_NAME_SANITIZE = /[^a-zA-Z0-9_-]+/g;
const MAX_SERVER_LABEL_LENGTH = 24;
const MAX_TOOL_LABEL_LENGTH = 32;
// Room kept for the collision ordinal (`_2` … `_1000`) so an assigned name never
// exceeds TOOL_NAME_MAX_LENGTH, whatever the truncation produced.
const TOOL_NAME_ORDINAL_RESERVE = 5;

export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sanitizeToolName = (value: string): string => {
  const cleaned = value.trim().replace(TOOL_NAME_SANITIZE, '_').replace(/_+/g, '_');
  return cleaned.replace(/^_+|_+$/g, '');
};

// The server row's human name is what the model should read; the id is the fallback
// for a name that sanitizes away (empty, or only unsupported characters).
export const serverToolLabel = (server: McpServer): string =>
  sanitizeToolName(server.name) || sanitizeToolName(server.id) || 'server';

export const fitToolName = (serverLabel: string, toolLabel: string): string => {
  const server = sanitizeToolName(serverLabel).slice(0, MAX_SERVER_LABEL_LENGTH) || 'server';
  const budget = Math.max(
    1,
    TOOL_NAME_MAX_LENGTH -
      TOOL_NAME_PREFIX.length -
      server.length -
      1 -
      TOOL_NAME_ORDINAL_RESERVE
  );
  const tool =
    sanitizeToolName(toolLabel).slice(0, Math.min(MAX_TOOL_LABEL_LENGTH, budget)) || 'tool';
  return `${TOOL_NAME_PREFIX}${server}_${tool}`;
};

// The model-visible name is the tool's identity, so duplicates get the next stable
// ordinal — never a digest. The order comes from sorted server id then tool name,
// so the same set of connected servers always yields the same names across restarts.
export const assignToolNames = (candidates: readonly McpToolCandidate[]): McpToolRegistration[] => {
  const taken = new Set<string>();
  return candidates.map(candidate => {
    const base = fitToolName(serverToolLabel(candidate.server), candidate.tool.name);
    let internalName = base;
    let ordinal = 1;
    while (taken.has(internalName)) {
      ordinal += 1;
      internalName = `${base}_${ordinal}`;
    }
    taken.add(internalName);
    return { ...candidate, internalName };
  });
};

const sanitizeToolSchema = (schema: unknown): Record<string, unknown> => {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  const raw = schema as Record<string, unknown>;
  if (raw.type !== 'object') {
    return { type: 'object', properties: {} };
  }
  try {
    const serialized = JSON.stringify(raw);
    if (serialized.length > MAX_SCHEMA_BYTES) {
      return { type: 'object', properties: {} };
    }
  } catch {
    return { type: 'object', properties: {} };
  }
  return raw;
};

export const isToolSafe = (tool: McpToolCatalogItem): boolean => {
  const annotations = tool.annotations;
  if (!annotations) return false;
  if (annotations.destructiveHint) return false;
  if (annotations.openWorldHint) return false;
  return annotations.readOnlyHint === true;
};

export const resolveApprovalMode = (
  server: McpServer,
  defaultMode: McpApprovalMode
): McpApprovalMode => {
  if (
    server.approval_mode === 'always' ||
    server.approval_mode === 'safe-only' ||
    server.approval_mode === 'never'
  ) {
    return server.approval_mode;
  }
  return defaultMode;
};

export const parseToolCatalog = (tools: Array<Record<string, unknown>>): McpToolCatalogItem[] =>
  tools
    .map(tool => {
      const name = typeof tool.name === 'string' ? tool.name.trim() : '';
      if (!name) return null;
      return {
        name,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: sanitizeToolSchema(tool.inputSchema),
        outputSchema:
          tool.outputSchema && typeof tool.outputSchema === 'object'
            ? sanitizeToolSchema(tool.outputSchema)
            : undefined,
        annotations:
          tool.annotations && typeof tool.annotations === 'object'
            ? (tool.annotations as McpToolCatalogItem['annotations'])
            : undefined,
        title: typeof tool.title === 'string' ? tool.title : undefined,
      } as McpToolCatalogItem;
    })
    .filter((tool): tool is McpToolCatalogItem => tool !== null);

export const normalizeToolAllowlist = (allowlist: string[] | null | undefined): Set<string> | null => {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return null;
  const cleaned = allowlist.map(name => name.trim()).filter(Boolean);
  return cleaned.length > 0 ? new Set(cleaned) : null;
};

export const buildConnectedServerCatalog = (
  connections: Iterable<McpCatalogConnection>,
  allowedServerIds?: readonly string[]
): PtcMcpServerDescriptor[] => {
  // Distinguish `undefined` (all connected servers) from explicit `[]` (no servers allowed).
  const allowed =
    allowedServerIds !== undefined
      ? new Set(allowedServerIds.map(id => id.trim()).filter(Boolean))
      : null;

  const sorted = [...connections]
    .filter(c => c.status.state === 'connected' && (allowed === null || allowed.has(c.server.id)))
    .sort((a, b) => compareStrings(a.server.id, b.server.id));

  const descriptors: PtcMcpServerDescriptor[] = [];
  const takenServerSafe = new Set<string>();

  for (const conn of sorted) {
    const baseSafe = sanitizeJsIdentifier(conn.server.name || conn.server.id, 'server');
    let safeName = baseSafe;
    let ord = 1;
    while (takenServerSafe.has(safeName)) {
      ord += 1;
      safeName = `${baseSafe}_${ord}`;
    }
    takenServerSafe.add(safeName);

    const allowlist = normalizeToolAllowlist(conn.server.tool_allowlist);
    const takenToolSafe = new Set<string>();
    const tools = [...conn.tools]
      .filter(t => !allowlist || allowlist.has(t.name))
      .sort((a, b) => compareStrings(a.name, b.name))
      .map(t => {
        const baseTool = sanitizeJsIdentifier(t.name, 'tool');
        let toolSafe = baseTool;
        let tOrd = 1;
        while (takenToolSafe.has(toolSafe)) {
          tOrd += 1;
          toolSafe = `${baseTool}_${tOrd}`;
        }
        takenToolSafe.add(toolSafe);
        return {
          name: t.name,
          safeName: toolSafe,
          internalName: fitToolName(serverToolLabel(conn.server), t.name),
          ...(t.description ? { description: t.description } : {}),
          inputSchema: t.inputSchema,
          ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
        };
      });

    descriptors.push({
      id: conn.server.id,
      name: conn.server.name,
      safeName,
      tools,
    });
  }

  return descriptors;
};

export const resolveServerToolByName = (
  catalog: readonly PtcMcpServerDescriptor[],
  serverRef: string,
  toolRef: string
): { serverId: string; toolName: string } => {
  const sKey = serverRef.trim().toLowerCase();
  const server = catalog.find(
    s =>
      s.safeName.toLowerCase() === sKey ||
      s.name.toLowerCase() === sKey ||
      s.id.toLowerCase() === sKey
  );
  if (!server) {
    throw new Error(
      `MCP server "${serverRef}" is not connected. Connected: ${catalog.map(s => s.safeName).join(', ') || '(none)'}`
    );
  }
  const tKey = toolRef.trim().toLowerCase();
  const tool = server.tools.find(
    t => t.safeName.toLowerCase() === tKey || t.name.toLowerCase() === tKey
  );
  if (!tool) {
    throw new Error(
      `MCP tool "${toolRef}" not found on server "${server.safeName}". Available: ${server.tools.map(t => t.safeName).join(', ') || '(none)'}`
    );
  }
  return { serverId: server.id, toolName: tool.name };
};
