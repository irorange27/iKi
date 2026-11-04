import { EventEmitter } from 'node:events';

// eslint-disable-next-line import/no-unresolved
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// eslint-disable-next-line import/no-unresolved
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
// eslint-disable-next-line import/no-unresolved
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getAppConfig } from '../config';
import { getToolRuntimeContext } from '../utils/runtime_context';
import { createLogger } from '@iki/backend/logger';
import {
  addMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
} from '../db/mcp_servers';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { resolveMcpToolResult } from './tool_results';
import { createPrefixedId } from '@iki/backend/utils/id';
import { getErrorMessage } from '@iki/backend/utils/errors';
import type {
  McpApprovalMode,
  McpServer,
  McpServerInput,
  McpServerStatus,
  McpServerSummary,
  McpToolCatalogItem,
} from '@iki/backend/types/mcp';

type McpConnection = {
  server: McpServer;
  client: Client;
  transport: Transport;
  status: McpServerStatus;
  tools: McpToolCatalogItem[];
};

type McpToolCandidate = {
  server: McpServer;
  tool: McpToolCatalogItem;
};

type McpToolRegistration = McpToolCandidate & {
  internalName: string;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MAX_SCHEMA_BYTES = 20000;
const mcpManagerLogger = createLogger({ module: 'mcp_manager' });

const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_NAME_PREFIX = 'mcp_';
const TOOL_NAME_SANITIZE = /[^a-zA-Z0-9_-]+/g;
const MAX_SERVER_LABEL_LENGTH = 24;
const MAX_TOOL_LABEL_LENGTH = 32;
// Room kept for the collision ordinal (`_2` … `_1000`) so an assigned name never
// exceeds TOOL_NAME_MAX_LENGTH, whatever the truncation produced.
const TOOL_NAME_ORDINAL_RESERVE = 5;

const sanitizeToolName = (value: string): string => {
  const cleaned = value.trim().replace(TOOL_NAME_SANITIZE, '_').replace(/_+/g, '_');
  return cleaned.replace(/^_+|_+$/g, '');
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// The server row's human name is what the model should read; the id is the fallback
// for a name that sanitizes away (empty, or only unsupported characters).
const serverToolLabel = (server: McpServer): string =>
  sanitizeToolName(server.name) || sanitizeToolName(server.id) || 'server';

const fitToolName = (serverLabel: string, toolLabel: string): string => {
  const server = sanitizeToolName(serverLabel).slice(0, MAX_SERVER_LABEL_LENGTH) || 'server';
  const budget = Math.max(
    1,
    TOOL_NAME_MAX_LENGTH -
      TOOL_NAME_PREFIX.length -
      server.length -
      1 -
      TOOL_NAME_ORDINAL_RESERVE
  );
  const tool = sanitizeToolName(toolLabel).slice(0, Math.min(MAX_TOOL_LABEL_LENGTH, budget)) || 'tool';
  return `${TOOL_NAME_PREFIX}${server}_${tool}`;
};

// The model-visible name is the tool's identity, so duplicates get the next stable
// ordinal — never a digest. The order comes from McpManager.toolCandidates(), which is
// sorted by server id then tool name, so the same set of connected servers always
// yields the same names, across reconnects and restarts.
const assignToolNames = (candidates: readonly McpToolCandidate[]): McpToolRegistration[] => {
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

const isLocalUrl = (url: URL): boolean => LOCAL_HOSTS.has(url.hostname);

const mergeRequestHeaders = (
  baseHeaders: Record<string, string>,
  requestHeaders?: HeadersInit
): Record<string, string> => {
  const merged: Record<string, string> = { ...baseHeaders };

  if (!requestHeaders) return merged;

  if (Array.isArray(requestHeaders)) {
    for (const [key, value] of requestHeaders) {
      merged[key] = value;
    }
    return merged;
  }

  if (requestHeaders instanceof Headers) {
    for (const [key, value] of requestHeaders.entries()) {
      merged[key] = value;
    }
    return merged;
  }

  for (const [key, value] of Object.entries(requestHeaders)) {
    merged[key] = String(value);
  }

  return merged;
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

const isToolSafe = (tool: McpToolCatalogItem): boolean => {
  const annotations = tool.annotations;
  if (!annotations) return false;
  if (annotations.destructiveHint) return false;
  if (annotations.openWorldHint) return false;
  return annotations.readOnlyHint === true;
};

const resolveApprovalMode = (server: McpServer, defaultMode: McpApprovalMode): McpApprovalMode => {
  if (
    server.approval_mode === 'always' ||
    server.approval_mode === 'safe-only' ||
    server.approval_mode === 'never'
  ) {
    return server.approval_mode;
  }
  return defaultMode;
};

const parseToolCatalog = (tools: Array<Record<string, unknown>>): McpToolCatalogItem[] =>
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

const normalizeToolAllowlist = (allowlist: string[] | null | undefined): Set<string> | null => {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return null;
  const cleaned = allowlist.map(name => name.trim()).filter(Boolean);
  return cleaned.length > 0 ? new Set(cleaned) : null;
};

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.queue = this.queue.filter(entry => entry !== grant);
        reject(signal?.reason);
      };
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        this.active += 1;
        resolve(() => this.release());
      };
      this.queue.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

export class McpManager extends EventEmitter {
  private connections = new Map<string, McpConnection>();
  private semaphore: Semaphore;
  private semaphoreLimit: number;

  constructor() {
    super();
    const config = getAppConfig().mcp;
    const maxConcurrent =
      typeof config?.maxConcurrentRequests === 'number'
        ? Math.max(1, Math.trunc(config.maxConcurrentRequests))
        : 4;
    this.semaphoreLimit = maxConcurrent;
    this.semaphore = new Semaphore(maxConcurrent);
  }

  private ensureSemaphore() {
    const config = getAppConfig().mcp;
    const limit =
      typeof config?.maxConcurrentRequests === 'number'
        ? Math.max(1, Math.trunc(config.maxConcurrentRequests))
        : this.semaphoreLimit;
    if (limit !== this.semaphoreLimit) {
      this.semaphoreLimit = limit;
      this.semaphore = new Semaphore(limit);
    }
  }

  private getRequestOptions(): RequestOptions {
    const config = getAppConfig().mcp;
    const timeout =
      typeof config?.requestTimeoutMs === 'number'
        ? Math.max(1000, Math.trunc(config.requestTimeoutMs))
        : 20000;
    return { timeout };
  }

  private updateStatus(serverId: string, status: McpServerStatus) {
    const connection = this.connections.get(serverId);
    if (connection) {
      connection.status = status;
    }
    this.emit('status-changed', serverId, status);
  }

  // Tool names are the model-visible identity of a tool, so the whole MCP tool set is
  // planned from the connected servers in one stable order (server id, then tool name).
  // Registering one server can therefore rename another server's tool: whenever the
  // catalog changes, the MCP slice of the registry is rebuilt from this plan instead of
  // patched per server.
  private toolCandidates(): McpToolCandidate[] {
    const candidates: McpToolCandidate[] = [];
    const connections = [...this.connections.values()].sort((a, b) =>
      compareStrings(a.server.id, b.server.id)
    );
    for (const connection of connections) {
      const allowlist = normalizeToolAllowlist(connection.server.tool_allowlist);
      for (const tool of [...connection.tools].sort((a, b) => compareStrings(a.name, b.name))) {
        if (allowlist && !allowlist.has(tool.name)) continue;
        candidates.push({ server: connection.server, tool });
      }
    }
    return candidates;
  }

  private syncRegisteredTools() {
    defaultToolRegistry.removeBySource(source => source?.kind === 'mcp');
    const config = getAppConfig().mcp;

    for (const { server, tool, internalName } of assignToolNames(this.toolCandidates())) {
      const approvalMode = resolveApprovalMode(server, config.defaultApprovalMode);
      const displayName = tool.title || tool.annotations?.title || tool.name;
      const needsApproval =
        approvalMode === 'always' ? true : approvalMode === 'never' ? false : !isToolSafe(tool);

      const agentTool = createTool({
        name: internalName,
        type: 'function',
        description: tool.description || `MCP tool ${tool.name}`,
        parameters: tool.inputSchema,
        outputSchema: tool.outputSchema,
        needsApproval,
        ...(approvalMode === 'always' ? { approvalMode: 'always' as const } : {}),
        autoAllowed: true,
        displayName,
        source: { kind: 'mcp', id: server.id, name: server.name },
        handler: async (args: Record<string, unknown>) => {
          return await this.callTool(server.id, tool.name, args);
        },
      });

      defaultToolRegistry.register(agentTool);
    }
  }

  private registerServerTools(server: McpServer, tools: McpToolCatalogItem[]) {
    const connection = this.connections.get(server.id);
    if (connection) {
      connection.server = server;
      connection.tools = tools;
    }
    this.syncRegisteredTools();
    this.emit('tools-changed', server.id, tools.length);
  }

  private async buildTransport(server: McpServer): Promise<Transport> {
    if (server.transport === 'stdio') {
      if (!server.command || !server.command.trim()) {
        throw new Error('MCP stdio server requires a command');
      }
      return new StdioClientTransport({
        command: server.command,
        args: server.args ?? undefined,
        cwd: server.cwd ?? undefined,
        env: server.env ?? undefined,
        stderr: 'pipe',
      });
    }

    if (server.transport === 'streamable-http') {
      if (!server.base_url || !server.base_url.trim()) {
        throw new Error('MCP HTTP server requires a base URL');
      }
      const url = new URL(server.base_url.trim());
      const config = getAppConfig().mcp;
      if (!config.allowRemoteServers && !isLocalUrl(url)) {
        throw new Error('Remote MCP servers are disabled');
      }
      if (!isLocalUrl(url) && url.protocol !== 'https:') {
        throw new Error('Remote MCP servers must use HTTPS');
      }

      const headers: Record<string, string> = {
        ...(server.headers ?? {}),
      };
      const requestInit: RequestInit = { headers, redirect: 'error' };

      return new StreamableHTTPClientTransport(url, {
        requestInit,
      });
    }

    if (server.transport === 'sse') {
      if (!server.base_url || !server.base_url.trim()) {
        throw new Error('MCP SSE server requires a base URL');
      }
      const url = new URL(server.base_url.trim());
      const config = getAppConfig().mcp;
      if (!config.allowRemoteServers && !isLocalUrl(url)) {
        throw new Error('Remote MCP servers are disabled');
      }
      if (!isLocalUrl(url) && url.protocol !== 'https:') {
        throw new Error('Remote MCP servers must use HTTPS');
      }

      const headers: Record<string, string> = {
        ...(server.headers ?? {}),
      };
      const requestInit: RequestInit = { headers, redirect: 'error' };
      const eventSourceFetch: typeof fetch = async (input, init = {}) => {
        return await fetch(input, {
          ...init,
          headers: mergeRequestHeaders(headers, init.headers),
          redirect: 'error',
        });
      };

      return new SSEClientTransport(url, {
        eventSourceInit: { fetch: eventSourceFetch },
        requestInit,
      });
    }

    throw new Error(`Unsupported MCP transport: ${server.transport}`);
  }

  private async loadTools(client: Client): Promise<McpToolCatalogItem[]> {
    const result = await client.listTools(undefined, this.getRequestOptions());
    return parseToolCatalog(
      Array.isArray(result.tools) ? (result.tools as Array<Record<string, unknown>>) : []
    );
  }

  private async connectInternal(server: McpServer): Promise<McpConnection> {
    const client = new Client(
      { name: 'iKi', version: '0.0.1' },
      {
        listChanged: {
          tools: {
            onChanged: async error => {
              if (error) {
                mcpManagerLogger.event({
                  level: 'warn',
                  event: 'mcp.tools.refresh',
                  outcome: 'failed',
                  error,
                  data: {
                    server_id: server.id,
                    source: 'list_changed',
                  },
                });
                return;
              }
              try {
                await this.refreshTools(server.id);
              } catch (err) {
                mcpManagerLogger.event({
                  level: 'warn',
                  event: 'mcp.tools.refresh',
                  outcome: 'degraded',
                  error: err,
                  message: 'Tool refresh failed after list_changed notification.',
                  data: {
                    server_id: server.id,
                    source: 'list_changed',
                  },
                });
              }
            },
          },
        },
      }
    );

    const transport = await this.buildTransport(server);
    await client.connect(transport);
    const tools = await this.loadTools(client);

    const status: McpServerStatus = {
      state: 'connected',
      toolCount: tools.length,
      lastError: null,
    };

    return { server, client, transport, status, tools };
  }

  async initialize(): Promise<void> {
    const config = getAppConfig().mcp;
    if (!config?.enabled) return;

    if (!config.connectOnStartup) return;
    const servers = listMcpServers().filter(server => server.enabled);
    for (const server of servers) {
      try {
        await this.connectServer(server.id);
      } catch (error) {
        mcpManagerLogger.event({
          level: 'warn',
          event: 'mcp.connect',
          outcome: 'failed',
          error,
          message: 'Failed to connect MCP server on startup.',
          data: {
            server_id: server.id,
            source: 'startup',
          },
        });
      }
    }
  }

  listServers(): McpServerSummary[] {
    const rows = listMcpServers();
    return rows.map(server => ({
      ...server,
      status: this.connections.get(server.id)?.status,
    }));
  }

  async addServer(input: McpServerInput): Promise<McpServer> {
    const id = createPrefixedId('mcp', { randomLength: 6 });
    addMcpServer({ ...input, id });
    const server = getMcpServer(id);
    if (!server) {
      throw new Error('Failed to create MCP server');
    }

    if (server.enabled && getAppConfig().mcp.enabled) {
      await this.connectServer(server.id);
    }
    return server;
  }

  async updateServer(id: string, updates: Partial<McpServerInput>): Promise<McpServer> {
    updateMcpServer(id, updates);
    const server = getMcpServer(id);
    if (!server) {
      throw new Error('MCP server not found');
    }

    if (!getAppConfig().mcp.enabled) {
      await this.disconnectServer(id);
      return server;
    }

    if (server.enabled) {
      await this.connectServer(id, { force: true });
    } else {
      await this.disconnectServer(id);
    }

    return server;
  }

  async deleteServer(id: string): Promise<void> {
    await this.disconnectServer(id);
    deleteMcpServer(id);
  }

  async connectServer(id: string, options?: { force?: boolean }): Promise<McpServerStatus> {
    const config = getAppConfig().mcp;
    if (!config?.enabled) {
      throw new Error('MCP is disabled in settings');
    }

    const server = getMcpServer(id);
    if (!server) {
      throw new Error('MCP server not found');
    }
    if (!server.enabled) {
      throw new Error('MCP server is disabled');
    }

    const existing = this.connections.get(id);
    if (existing && !options?.force) {
      return existing.status;
    }

    if (existing) {
      await this.disconnectServer(id);
    }

    this.updateStatus(id, { state: 'connecting', toolCount: 0 });

    try {
      const connection = await this.connectInternal(server);
      this.connections.set(id, connection);
      this.registerServerTools(server, connection.tools);
      updateMcpServer(id, {
        last_connected_at: new Date().toISOString(),
        last_error: null,
      });
      this.updateStatus(id, connection.status);
      return connection.status;
    } catch (error) {
      const message = getErrorMessage(error);
      updateMcpServer(id, { last_error: message });
      this.updateStatus(id, { state: 'error', toolCount: 0, lastError: message });
      throw error;
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const existing = this.connections.get(id);
    if (!existing) {
      this.syncRegisteredTools();
      return;
    }

    try {
      await existing.client.close();
    } catch (error) {
      mcpManagerLogger.event({
        level: 'warn',
        event: 'mcp.disconnect',
        outcome: 'degraded',
        error,
        message: 'Failed to close MCP client cleanly.',
        data: {
          server_id: id,
          resource: 'client',
        },
      });
    }

    try {
      await existing.transport.close();
    } catch {
    // Intentionally ignored: the caller cannot act on it.
  }

    this.connections.delete(id);
    this.syncRegisteredTools();
    this.updateStatus(id, { state: 'disconnected', toolCount: 0 });
  }

  async disconnectAll(): Promise<void> {
    const serverIds = listMcpServers().map(server => server.id);
    const results = await Promise.allSettled(
      serverIds.map(async id => {
        await this.disconnectServer(id);
      })
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        mcpManagerLogger.event({
          level: 'warn',
          event: 'mcp.disconnect',
          outcome: 'degraded',
          error: result.reason,
          message: 'Failed to disconnect MCP server.',
        });
      }
    }
  }

  refreshToolPolicies(): void {
    this.syncRegisteredTools();
    for (const connection of this.connections.values()) {
      this.emit('tools-changed', connection.server.id, connection.tools.length);
    }
  }

  async refreshTools(id: string): Promise<McpToolCatalogItem[]> {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error('MCP server is not connected');
    }
    const tools = await this.loadTools(connection.client);
    connection.tools = tools;
    connection.status = {
      state: 'connected',
      toolCount: tools.length,
      lastError: null,
    };
    this.registerServerTools(connection.server, tools);
    this.updateStatus(id, connection.status);
    return tools;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
    this.ensureSemaphore();
    const signal = getToolRuntimeContext().abortSignal;
    signal?.throwIfAborted();
    const release = await this.semaphore.acquire(signal);
    try {
      signal?.throwIfAborted();
      const connection = this.connections.get(serverId);
      if (!connection) {
        throw new Error('MCP server is not connected');
      }
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { ...this.getRequestOptions(), signal }
      );
      const typedResult = result as CallToolResult;
      const tool = connection.tools.find(candidate => candidate.name === toolName);
      return resolveMcpToolResult(tool, typedResult);
    } finally {
      release();
    }
  }
}
