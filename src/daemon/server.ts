import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { registerStandardTools } from '../core/tools';
import { getMcpManager } from '../core/mcp';
import { initializeDatabase } from '../core/db/database';
import { getUserDataPath, setPlatformInfo } from '../core/platform';
import { createChatService } from '../main/services/chat/chat_service';
import * as chatThreadDb from '../core/db/chat_thread';
import * as memoryDb from '../core/db/memory';
import {
  createAppClient,
  getAppClientById,
  getAppClientByToken,
  listAppClients,
  touchAppClient,
  type AppClient,
} from '../core/db/app_clients';
import { createNapCatReverseBridge } from './napcat_adapter';
import {
  DEFAULT_ALLOWED_TOOLS,
  readRequestedMcpServerIds,
  resolveMcpServerIdsForClient,
  resolveToolsForClient,
} from './tool_access';
import type { McpServerInput } from '../shared/types/mcp';
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '../shared/constants/daemon';

type DaemonSocket = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

type DaemonSocketServer = {
  handleUpgrade: (
    req: http.IncomingMessage,
    socket: unknown,
    head: Buffer,
    callback: (ws: DaemonSocket) => void
  ) => void;
  on: (
    event: 'connection',
    listener: (ws: DaemonSocket, req: http.IncomingMessage) => void
  ) => void;
  emit: (event: 'connection', ws: DaemonSocket, req: http.IncomingMessage) => boolean;
  close: () => void;
};

const nodeRequire = createRequire(__filename);

const { WebSocketServer } = nodeRequire('ws') as {
  WebSocketServer: new (options: {
    noServer: boolean;
  }) => DaemonSocketServer;
};

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

type DaemonClient = {
  id: string;
  name: string;
  scopes: string[];
  allowedTools: string[];
};

type WsSession = {
  id: number;
  ws: DaemonSocket;
  client: DaemonClient;
  webContents: { id: number; send: (channel: string, ...args: unknown[]) => void };
};

const DEFAULT_SCOPES = [
  'chat:read',
  'chat:write',
  'memory:read',
  'memory:write',
  'tools:run',
  'tools:approve',
  'mcp:read',
  'mcp:write',
];

const MAX_BODY_BYTES = 1024 * 1024 * 2;

const normalizeScopes = (scopes: unknown): string[] => {
  if (!Array.isArray(scopes)) return DEFAULT_SCOPES;
  const cleaned = scopes
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
  return cleaned;
};

const normalizeAllowedTools = (tools: unknown): string[] => {
  if (!Array.isArray(tools)) return DEFAULT_ALLOWED_TOOLS;
  const cleaned = tools
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
  return cleaned;
};

const ensureNapCatClient = (): string => {
  const existing = getAppClientById('client_napcat');
  if (existing) return existing.id;
  const created = createAppClient({
    id: 'client_napcat',
    name: 'NapCat',
    scopes: [],
    allowedTools: [],
  });
  return created.client.id;
};

const ensureUserDataDir = () => {
  const userDataPath = getUserDataPath();
  fs.mkdirSync(userDataPath, { recursive: true });
  return userDataPath;
};

const readOrCreateBootstrapToken = (userDataPath: string): string => {
  const tokenPath = path.join(userDataPath, 'daemon.token');
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // fall through to generate
  }

  const token = `iki_bootstrap_${Math.random().toString(36).slice(2, 10)}${Date.now()}`;
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8' });
  return token;
};

const writePortFile = (userDataPath: string, port: number) => {
  const portPath = path.join(userDataPath, 'daemon.port');
  fs.writeFileSync(portPath, String(port), { encoding: 'utf8' });
};

const writeHostFile = (userDataPath: string, host: string) => {
  const hostPath = path.join(userDataPath, 'daemon.host');
  fs.writeFileSync(hostPath, host, { encoding: 'utf8' });
};

const parseJsonBody = (req: http.IncomingMessage): Promise<JsonValue> =>
  new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;

    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });

const writeJson = (res: http.ServerResponse, status: number, payload: JsonValue) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const withCors = (res: http.ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Iki-Client, X-Iki-Setup-Token, X-Iki-Connection'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const toDaemonClient = (client: AppClient): DaemonClient => ({
  id: client.id,
  name: client.name,
  scopes: client.scopes,
  allowedTools: client.allowedTools,
});

const hasScope = (client: DaemonClient, scope: string): boolean => client.scopes.includes(scope);

const extractBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
};

const authenticateRequest = (
  req: http.IncomingMessage
): { client?: DaemonClient; error?: string } => {
  const token =
    extractBearerToken(req.headers.authorization as string | undefined) ||
    (typeof req.headers['x-iki-token'] === 'string' ? req.headers['x-iki-token'] : null);
  const clientId =
    typeof req.headers['x-iki-client'] === 'string' ? req.headers['x-iki-client'] : null;

  if (!token) return { error: 'Missing Authorization token' };
  if (!clientId) return { error: 'Missing X-Iki-Client header' };

  const client = getAppClientByToken(token);
  if (!client) return { error: 'Invalid token' };
  if (client.id !== clientId) return { error: 'Client id does not match token' };

  touchAppClient(client.id);
  return { client: toDaemonClient(client) };
};

const authenticateWebSocket = (
  req: http.IncomingMessage
): { client?: DaemonClient; error?: string } => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const tokenFromQuery = url.searchParams.get('token');
  const clientIdFromQuery = url.searchParams.get('client_id');
  const authHeaderToken = extractBearerToken(req.headers.authorization as string | undefined);
  const token = authHeaderToken || (typeof tokenFromQuery === 'string' ? tokenFromQuery : null);
  const clientId =
    (typeof req.headers['x-iki-client'] === 'string' ? req.headers['x-iki-client'] : null) ||
    (typeof clientIdFromQuery === 'string' ? clientIdFromQuery : null);

  if (!token) return { error: 'Missing Authorization token' };
  if (!clientId) return { error: 'Missing client_id' };

  const client = getAppClientByToken(token);
  if (!client) return { error: 'Invalid token' };
  if (client.id !== clientId) return { error: 'Client id does not match token' };

  touchAppClient(client.id);
  return { client: toDaemonClient(client) };
};

const getThreadOrError = (threadId: string, clientId: string) => {
  const thread = chatThreadDb.getChatThread(threadId);
  if (!thread) {
    return { status: 404, error: 'Thread not found' };
  }
  if (thread.client_id && thread.client_id !== clientId) {
    return { status: 403, error: 'Thread access denied' };
  }
  return { thread };
};

export const startDaemonServer = (options?: { port?: number; host?: string }) => {
  setPlatformInfo({
    userDataPath: process.env.IKI_USER_DATA_PATH,
    locale: process.env.IKI_LOCALE,
  });

  const userDataPath = ensureUserDataDir();
  const bootstrapToken = readOrCreateBootstrapToken(userDataPath);
  const port = Number.isFinite(options?.port) ? Number(options?.port) : DEFAULT_DAEMON_PORT;
  const host = options?.host?.trim() || DEFAULT_DAEMON_HOST;

  writePortFile(userDataPath, port);
  writeHostFile(userDataPath, host);
  initializeDatabase();
  registerStandardTools();
  void getMcpManager().initialize();

  const chatService = createChatService();
  const mcpManager = getMcpManager();
  const sessions = new Map<number, WsSession>();
  const wsSessions = new Map<DaemonSocket, WsSession>();
  let nextSessionId = 1;
  const napcatClientId = ensureNapCatClient();
  const napcatBridge = createNapCatReverseBridge({
    chatService,
    clientId: napcatClientId,
  });

  const server = http.createServer(async (req, res) => {
    withCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathName = url.pathname;

    if (req.method === 'GET' && pathName === '/v1/health') {
      writeJson(res, 200, {
        success: true,
        status: 'ok',
        uptime: process.uptime(),
        host,
        port,
      });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/clients/register') {
      const setupToken =
        typeof req.headers['x-iki-setup-token'] === 'string'
          ? req.headers['x-iki-setup-token']
          : '';
      if (bootstrapToken && setupToken !== bootstrapToken) {
        writeJson(res, 401, { success: false, error: 'Invalid setup token' });
        return;
      }

      try {
        const isFirstClient = listAppClients().length === 0;
        const body = (await parseJsonBody(req)) as Record<string, unknown>;
        const name =
          typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'iKi Client';
        const scopes = normalizeScopes(body.scopes);
        const allowedTools = normalizeAllowedTools(body.allowed_tools);

        const created = createAppClient({ name, scopes, allowedTools });
        if (isFirstClient) {
          chatThreadDb.assignClientToLegacyThreads(created.client.id);
        }
        writeJson(res, 200, {
          success: true,
          client_id: created.client.id,
          token: created.token,
          scopes: created.client.scopes,
          allowed_tools: created.client.allowedTools,
        });
        return;
      } catch (error) {
        writeJson(res, 400, { success: false, error: 'Invalid registration payload' });
        return;
      }
    }

    const auth = authenticateRequest(req);
    if (!auth.client) {
      writeJson(res, 401, { success: false, error: auth.error || 'Unauthorized' });
      return;
    }

    const client = auth.client;

    if (req.method === 'GET' && pathName === '/v1/chat/threads') {
      if (!hasScope(client, 'chat:read')) {
        writeJson(res, 403, { success: false, error: 'Missing chat:read scope' });
        return;
      }
      const threads = chatService.listThreads().filter(thread => thread.client_id === client.id);
      writeJson(res, 200, { success: true, threads });
      return;
    }

    if (req.method === 'GET' && pathName.startsWith('/v1/chat/threads/')) {
      if (!hasScope(client, 'chat:read')) {
        writeJson(res, 403, { success: false, error: 'Missing chat:read scope' });
        return;
      }
      const threadId = pathName.split('/').pop() || '';
      if (!threadId) {
        writeJson(res, 400, { success: false, error: 'Missing thread id' });
        return;
      }
      const result = getThreadOrError(threadId, client.id);
      if (!result.thread) {
        writeJson(res, result.status || 404, { success: false, error: result.error });
        return;
      }
      writeJson(res, 200, { success: true, thread: result.thread });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/chat/threads') {
      if (!hasScope(client, 'chat:write')) {
        writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
        return;
      }
      try {
        const body = (await parseJsonBody(req)) as Record<string, unknown>;
        const thread = chatService.createThread({
          ...(body || {}),
          client_id: client.id,
        });
        writeJson(res, 200, { success: true, thread });
        return;
      } catch (error) {
        writeJson(res, 400, { success: false, error: 'Invalid thread payload' });
        return;
      }
    }

    if (req.method === 'GET' && pathName === '/v1/chat/messages') {
      if (!hasScope(client, 'chat:read')) {
        writeJson(res, 403, { success: false, error: 'Missing chat:read scope' });
        return;
      }
      const threadId = url.searchParams.get('thread_id') || '';
      if (!threadId) {
        writeJson(res, 400, { success: false, error: 'Missing thread_id' });
        return;
      }
      const access = getThreadOrError(threadId, client.id);
      if (!access.thread) {
        writeJson(res, access.status || 404, { success: false, error: access.error });
        return;
      }
      const messages = chatService.listMessages(threadId);
      writeJson(res, 200, { success: true, messages });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/chat/send') {
      if (!hasScope(client, 'chat:write')) {
        writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
        return;
      }
      try {
        const body = (await parseJsonBody(req)) as Record<string, unknown>;
        const threadId = typeof body.thread_id === 'string' ? body.thread_id : undefined;
        if (threadId) {
          const access = getThreadOrError(threadId, client.id);
          if (!access.thread) {
            writeJson(res, access.status || 404, { success: false, error: access.error });
            return;
          }
        }

        const providerType = typeof body.providerType === 'string' ? body.providerType : '';
        const model = typeof body.model === 'string' ? body.model : '';
        if (!providerType || !model) {
          writeJson(res, 400, { success: false, error: 'Missing providerType or model' });
          return;
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const tools = resolveToolsForClient(body.tools, client.allowedTools);
        const requestedMcpServerIds = readRequestedMcpServerIds(body);
        const mcpServerIds = resolveMcpServerIdsForClient(requestedMcpServerIds, client.allowedTools);
        if ((tools.length > 0 || mcpServerIds.length > 0) && !hasScope(client, 'tools:run')) {
          writeJson(res, 403, { success: false, error: 'Missing tools:run scope' });
          return;
        }

        const result = await chatService.send({
          providerType,
          model,
          messages,
          tools,
          mcpServerIds,
          skillIds: Array.isArray(body.skillIds) ? (body.skillIds as string[]) : undefined,
          skillMode:
            body.skillMode === 'manual' || body.skillMode === 'auto' ? body.skillMode : undefined,
          threadId,
        });

        writeJson(res, 200, result);
        return;
      } catch (error) {
        writeJson(res, 400, { success: false, error: 'Invalid chat payload' });
        return;
      }
    }

    if (req.method === 'POST' && pathName === '/v1/chat/approve-tool') {
      if (!hasScope(client, 'tools:approve')) {
        writeJson(res, 403, { success: false, error: 'Missing tools:approve scope' });
        return;
      }
      try {
        const body = (await parseJsonBody(req)) as Record<string, unknown>;
        const approvalId = typeof body.approval_id === 'string' ? body.approval_id : '';
        const approved = Boolean(body.approved);
        const connectionId =
          typeof body.connection_id === 'number'
            ? body.connection_id
            : typeof req.headers['x-iki-connection'] === 'string'
              ? Number(req.headers['x-iki-connection'])
              : null;

        if (!approvalId) {
          writeJson(res, 400, { success: false, error: 'Missing approval_id' });
          return;
        }

        const session = connectionId ? sessions.get(connectionId) : null;
        if (!session || session.client.id !== client.id) {
          writeJson(res, 400, { success: false, error: 'Missing or invalid connection_id' });
          return;
        }

        const result = await chatService.approveTool(session.webContents, approvalId, approved);
        writeJson(res, 200, result);
        return;
      } catch (error) {
        writeJson(res, 400, { success: false, error: 'Invalid approval payload' });
        return;
      }
    }

    if (req.method === 'POST' && pathName === '/v1/chat/stop-stream') {
      if (!hasScope(client, 'chat:write')) {
        writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
        return;
      }
      const connectionId =
        typeof req.headers['x-iki-connection'] === 'string'
          ? Number(req.headers['x-iki-connection'])
          : null;
      if (!connectionId || Number.isNaN(connectionId)) {
        writeJson(res, 400, { success: false, error: 'Missing X-Iki-Connection header' });
        return;
      }
      const session = sessions.get(connectionId);
      if (!session || session.client.id !== client.id) {
        writeJson(res, 400, { success: false, error: 'Invalid connection_id' });
        return;
      }
      const result = chatService.stopStream(connectionId);
      writeJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && pathName === '/v1/memory/short') {
      if (!hasScope(client, 'memory:read')) {
        writeJson(res, 403, { success: false, error: 'Missing memory:read scope' });
        return;
      }
      const threadId = url.searchParams.get('thread_id') || '';
      if (!threadId) {
        writeJson(res, 400, { success: false, error: 'Missing thread_id' });
        return;
      }
      const access = getThreadOrError(threadId, client.id);
      if (!access.thread) {
        writeJson(res, access.status || 404, { success: false, error: access.error });
        return;
      }
      const limit = Number(url.searchParams.get('limit') || '');
      const rows = memoryDb.listShortMemory(threadId, Number.isFinite(limit) ? limit : undefined);
      writeJson(res, 200, { success: true, entries: rows });
      return;
    }

    if (req.method === 'GET' && pathName === '/v1/memory/long') {
      if (!hasScope(client, 'memory:read')) {
        writeJson(res, 403, { success: false, error: 'Missing memory:read scope' });
        return;
      }
      const threadId = url.searchParams.get('thread_id') || '';
      if (!threadId) {
        writeJson(res, 400, { success: false, error: 'Missing thread_id' });
        return;
      }
      const access = getThreadOrError(threadId, client.id);
      if (!access.thread) {
        writeJson(res, access.status || 404, { success: false, error: access.error });
        return;
      }
      const limit = Number(url.searchParams.get('limit') || '');
      const rows = memoryDb.listLongMemory(threadId, Number.isFinite(limit) ? limit : undefined);
      writeJson(res, 200, { success: true, entries: rows });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/memory/search') {
      if (!hasScope(client, 'memory:read')) {
        writeJson(res, 403, { success: false, error: 'Missing memory:read scope' });
        return;
      }
      try {
        const body = (await parseJsonBody(req)) as Record<string, unknown>;
        const query = typeof body.query === 'string' ? body.query : '';
        if (!query.trim()) {
          writeJson(res, 400, { success: false, error: 'Missing query' });
          return;
        }
        const limit = typeof body.limit === 'number' ? body.limit : undefined;
        const threshold = typeof body.threshold === 'number' ? body.threshold : undefined;
        const includeIncognito = Boolean(body.include_incognito);
        const results = memoryDb.searchLongMemoryAcrossThreads(query, {
          limit,
          threshold,
          includeIncognito,
          clientId: client.id,
        });
        writeJson(res, 200, { success: true, results });
        return;
      } catch (error) {
        writeJson(res, 400, { success: false, error: 'Invalid search payload' });
        return;
      }
    }

    if (req.method === 'GET' && pathName === '/v1/mcp/servers') {
      if (!hasScope(client, 'mcp:read')) {
        writeJson(res, 403, { success: false, error: 'Missing mcp:read scope' });
        return;
      }
      const servers = mcpManager.listServers();
      writeJson(res, 200, { success: true, servers });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/mcp/servers') {
      if (!hasScope(client, 'mcp:write')) {
        writeJson(res, 403, { success: false, error: 'Missing mcp:write scope' });
        return;
      }
      try {
        const body = (await parseJsonBody(req)) as McpServerInput;
        const created = await mcpManager.addServer(body);
        writeJson(res, 200, { success: true, server: created });
        return;
      } catch (error) {
        writeJson(res, 400, {
          success: false,
          error: error instanceof Error ? error.message : 'Invalid MCP server payload',
        });
        return;
      }
    }

    const mcpMatch = pathName.match(/^\/v1\/mcp\/servers\/([^/]+)(?:\/([^/]+))?$/);
    if (req.method === 'POST' && mcpMatch) {
      const serverId = mcpMatch[1];
      const action = mcpMatch[2];
      if (!serverId) {
        writeJson(res, 400, { success: false, error: 'Missing MCP server id' });
        return;
      }

      if (action === 'connect') {
        if (!hasScope(client, 'mcp:write')) {
          writeJson(res, 403, { success: false, error: 'Missing mcp:write scope' });
          return;
        }
        try {
          const status = await mcpManager.connectServer(serverId);
          writeJson(res, 200, { success: true, status });
        } catch (error) {
          writeJson(res, 400, {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to connect MCP server',
          });
        }
        return;
      }

      if (action === 'disconnect') {
        if (!hasScope(client, 'mcp:write')) {
          writeJson(res, 403, { success: false, error: 'Missing mcp:write scope' });
          return;
        }
        await mcpManager.disconnectServer(serverId);
        writeJson(res, 200, { success: true });
        return;
      }

      if (action === 'refresh-tools') {
        if (!hasScope(client, 'mcp:read')) {
          writeJson(res, 403, { success: false, error: 'Missing mcp:read scope' });
          return;
        }
        try {
          const tools = await mcpManager.refreshTools(serverId);
          writeJson(res, 200, { success: true, tools });
        } catch (error) {
          writeJson(res, 400, {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to refresh tools',
          });
        }
        return;
      }

      if (action === 'delete') {
        if (!hasScope(client, 'mcp:write')) {
          writeJson(res, 403, { success: false, error: 'Missing mcp:write scope' });
          return;
        }
        await mcpManager.deleteServer(serverId);
        writeJson(res, 200, { success: true });
        return;
      }

      if (!action) {
        if (!hasScope(client, 'mcp:write')) {
          writeJson(res, 403, { success: false, error: 'Missing mcp:write scope' });
          return;
        }
        try {
          const body = (await parseJsonBody(req)) as Partial<McpServerInput>;
          const updated = await mcpManager.updateServer(serverId, body);
          writeJson(res, 200, { success: true, server: updated });
        } catch (error) {
          writeJson(res, 400, {
            success: false,
            error: error instanceof Error ? error.message : 'Invalid MCP server update',
          });
        }
        return;
      }
    }

    writeJson(res, 404, { success: false, error: 'Not found' });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/v1/chat/stream') {
      const auth = authenticateWebSocket(req);
      if (!auth.client) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, ws => {
        const id = nextSessionId++;
        const webContents = {
          id,
          send: (channel: string, ...args: unknown[]) => {
            if (ws.readyState !== 1) return;
            if (channel === 'chat:ui-chunk' && args.length === 1) {
              ws.send(JSON.stringify(args[0]));
              return;
            }
            ws.send(JSON.stringify({ channel, payload: args }));
          },
        };

        const session: WsSession = {
          id,
          ws,
          client: auth.client as DaemonClient,
          webContents,
        };
        sessions.set(id, session);
        wsSessions.set(ws, session);

        ws.on('close', () => {
          sessions.delete(id);
          wsSessions.delete(ws);
        });

        ws.send(
          JSON.stringify({ channel: 'daemon', payload: { type: 'ready', connection_id: id } })
        );
        wss.emit('connection', ws, req);
      });
      return;
    }

    if (napcatBridge.handleUpgrade(req, socket, head)) {
      return;
    }

    socket.destroy();
  });

  wss.on('connection', ws => {
    const session = wsSessions.get(ws);
    if (!session) return;

    ws.on('message', async (data: unknown) => {
      try {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        const messageType = typeof parsed.type === 'string' ? parsed.type : '';

        if (messageType === 'start') {
          if (!hasScope(session.client, 'chat:write')) {
            ws.send(
              JSON.stringify({
                channel: 'daemon',
                payload: { type: 'error', error: 'Missing chat:write scope' },
              })
            );
            return;
          }
          const payload = (parsed.payload ?? {}) as Record<string, unknown>;
          const threadId = typeof payload.thread_id === 'string' ? payload.thread_id : undefined;
          if (threadId) {
            const access = getThreadOrError(threadId, session.client.id);
            if (!access.thread) {
              ws.send(
                JSON.stringify({
                  channel: 'daemon',
                  payload: { type: 'error', error: access.error || 'Thread not found' },
                })
              );
              return;
            }
          }

          const providerType = typeof payload.providerType === 'string' ? payload.providerType : '';
          const model = typeof payload.model === 'string' ? payload.model : '';
          if (!providerType || !model) {
            ws.send(
              JSON.stringify({
                channel: 'daemon',
                payload: { type: 'error', error: 'Missing providerType or model' },
              })
            );
            return;
          }
          const messages = Array.isArray(payload.messages) ? payload.messages : [];
          const tools = resolveToolsForClient(payload.tools, session.client.allowedTools);
          const requestedMcpServerIds = readRequestedMcpServerIds(payload);
          const mcpServerIds = resolveMcpServerIdsForClient(
            requestedMcpServerIds,
            session.client.allowedTools
          );
          if ((tools.length > 0 || mcpServerIds.length > 0) && !hasScope(session.client, 'tools:run')) {
            ws.send(
              JSON.stringify({
                channel: 'daemon',
                payload: { type: 'error', error: 'Missing tools:run scope' },
              })
            );
            return;
          }

          const result = await chatService.stream(session.webContents, {
            providerType,
            model,
            messages,
            tools,
            mcpServerIds,
            skillIds: Array.isArray(payload.skillIds) ? (payload.skillIds as string[]) : undefined,
            skillMode:
              payload.skillMode === 'manual' || payload.skillMode === 'auto'
                ? payload.skillMode
                : undefined,
            threadId,
          });

          ws.send(
            JSON.stringify({
              channel: 'daemon',
              payload: {
                type: 'stream-result',
                request_id: parsed.request_id || null,
                ...result,
              },
            })
          );
          return;
        }

        if (messageType === 'approve-tool') {
          if (!hasScope(session.client, 'tools:approve')) {
            ws.send(
              JSON.stringify({
                channel: 'daemon',
                payload: { type: 'error', error: 'Missing tools:approve scope' },
              })
            );
            return;
          }
          const approvalId = typeof parsed.approval_id === 'string' ? parsed.approval_id : '';
          const approved = Boolean(parsed.approved);
          if (!approvalId) {
            ws.send(
              JSON.stringify({
                channel: 'daemon',
                payload: { type: 'error', error: 'Missing approval_id' },
              })
            );
            return;
          }
          const result = await chatService.approveTool(session.webContents, approvalId, approved);
          ws.send(
            JSON.stringify({
              channel: 'daemon',
              payload: { type: 'approve-result', approval_id: approvalId, ...result },
            })
          );
          return;
        }

        if (messageType === 'stop') {
          const result = chatService.stopStream(session.webContents.id);
          ws.send(
            JSON.stringify({
              channel: 'daemon',
              payload: { type: 'stop-result', ...result },
            })
          );
          return;
        }
      } catch (error) {
        ws.send(
          JSON.stringify({
            channel: 'daemon',
            payload: { type: 'error', error: 'Invalid message payload' },
          })
        );
      }
    });
  });

  server.listen(port, host, () => {
    console.log(`[Daemon] listening on http://${host}:${port}`);
  });

  const shutdown = () => {
    server.close();
    wss.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, wss, port, host, bootstrapToken };
};
