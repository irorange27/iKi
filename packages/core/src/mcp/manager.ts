import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

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
import { createLogger } from '../logger';
import {
  addMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
} from '../db/mcp_servers';
import { createTool, defaultToolRegistry } from '../tools';
import { resolveMcpToolResult } from './tool_results';
import { createPrefixedId } from '../utils/id';
import type {
  McpApprovalMode,
  McpServer,
  McpServerInput,
  McpServerStatus,
  McpServerSummary,
  McpToolCatalogItem,
} from '../types/mcp';

type McpConnection = {
  server: McpServer;
  client: Client;
  transport: Transport;
  status: McpServerStatus;
  tools: McpToolCatalogItem[];
};

type ToolIndexEntry = {
  serverId: string;
  toolName: string;
};

type ManagerEvents = {
  'status-changed': (serverId: string, status: McpServerStatus) => void;
  'tools-changed': (serverId: string, toolCount: number) => void;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MAX_SCHEMA_BYTES = 20000;
const mcpManagerLogger = createLogger({ module: 'mcp_manager' });

const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_NAME_SANITIZE = /[^a-zA-Z0-9_-]+/g;

const sanitizeToolName = (value: string): string => {
  const cleaned = value.trim().replace(TOOL_NAME_SANITIZE, '_').replace(/_+/g, '_');
  return cleaned.replace(/^_+|_+$/g, '');
};

const buildInternalToolName = (serverId: string, toolName: string): string => {
  const hash = createHash('sha1').update(`${serverId}:${toolName}`).digest('hex').slice(0, 8);
  const safeTool = sanitizeToolName(toolName).slice(0, 32) || 'tool';
  const prefix = `mcp_${hash}_`;
  const candidate = `${prefix}${safeTool}`;
  if (candidate.length <= TOOL_NAME_MAX_LENGTH) return candidate;
  const remaining = Math.max(1, TOOL_NAME_MAX_LENGTH - prefix.length);
  return `${prefix}${safeTool.slice(0, remaining)}`;
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

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.active += 1;
        resolve(() => this.release());
      });
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
  private toolIndex = new Map<string, ToolIndexEntry>();
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

  private resetServerTools(serverId: string) {
    defaultToolRegistry.removeBySource(source => source?.kind === 'mcp' && source.id === serverId);
    for (const [name, entry] of this.toolIndex.entries()) {
      if (entry.serverId === serverId) {
        this.toolIndex.delete(name);
      }
    }
  }

  private registerServerTools(server: McpServer, tools: McpToolCatalogItem[]) {
    this.resetServerTools(server.id);
    const allowlist = normalizeToolAllowlist(server.tool_allowlist);
    const config = getAppConfig().mcp;
    const approvalMode = resolveApprovalMode(server, config.defaultApprovalMode);

    for (const tool of tools) {
      if (allowlist && !allowlist.has(tool.name)) continue;
      const internalName = buildInternalToolName(server.id, tool.name);
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
        autoAllowed: true,
        displayName,
        source: { kind: 'mcp', id: server.id, name: server.name },
        retry: { maxRetries: 1 },
        handler: async (args: Record<string, unknown>) => {
          return await this.callTool(server.id, tool.name, args);
        },
      });

      defaultToolRegistry.register(agentTool);
      this.toolIndex.set(internalName, { serverId: server.id, toolName: tool.name });
    }

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
      const message = error instanceof Error ? error.message : String(error);
      updateMcpServer(id, { last_error: message });
      this.updateStatus(id, { state: 'error', toolCount: 0, lastError: message });
      throw error;
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const existing = this.connections.get(id);
    if (!existing) {
      this.resetServerTools(id);
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
      // ignore
    }

    this.connections.delete(id);
    this.resetServerTools(id);
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
    for (const connection of this.connections.values()) {
      this.registerServerTools(connection.server, connection.tools);
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
    const release = await this.semaphore.acquire();
    try {
      const connection = this.connections.get(serverId);
      if (!connection) {
        throw new Error('MCP server is not connected');
      }
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        this.getRequestOptions()
      );
      const typedResult = result as CallToolResult;
      const tool = connection.tools.find(candidate => candidate.name === toolName);
      return resolveMcpToolResult(tool, typedResult);
    } finally {
      release();
    }
  }

  async callToolByInternalName(internalName: string, args: Record<string, unknown>) {
    const entry = this.toolIndex.get(internalName);
    if (!entry) {
      throw new Error(`MCP tool not found: ${internalName}`);
    }
    return this.callTool(entry.serverId, entry.toolName, args);
  }
}

export const onMcpManager = <K extends keyof ManagerEvents>(
  manager: McpManager,
  event: K,
  handler: ManagerEvents[K]
) => {
  manager.on(event, handler as (...args: unknown[]) => void);
};
