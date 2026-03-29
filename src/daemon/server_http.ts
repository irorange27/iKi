import http from 'node:http';

import * as memoryDb from '../core/db/memory';
import * as chatThreadDb from '../core/db/chat_thread';
import { createAppClient } from '../core/db/app_clients';
import type { McpManager } from '../core/mcp';
import type { ChatTransportMessage } from '../main/services/chat/chat_types';
import type { ChatService } from '../main/services/chat/chat_service';
import { rotateBootstrapToken } from './bootstrap_token';
import {
  readRequestedMcpServerIds,
  resolveMcpServerIdsForClient,
  resolveToolsForClient,
} from './tool_access';
import {
  getSchemaErrorMessage,
  parseApproveToolPayload,
  parseChatSendPayload,
  parseChatThreadCreatePayload,
  parseClientRegistrationPayload,
  parseMcpServerCreatePayload,
  parseMcpServerUpdatePayload,
  parseMemorySearchPayload,
} from './server_schemas';
import {
  authenticateRequest,
  getThreadOrError,
  hasScope,
  parseJsonBody,
  type WsSession,
  withCors,
  writeJson,
  isFirstUserClientRegistration,
} from './server_shared';

type CreateDaemonRequestHandlerDeps = {
  host: string;
  port: number;
  userDataPath: string;
  bootstrapTokenRef: { current: string };
  napcatClientId: string;
  chatService: ChatService;
  mcpManager: McpManager;
  sessions: Map<number, WsSession>;
};

export const createDaemonRequestHandler =
  (deps: CreateDaemonRequestHandlerDeps): http.RequestListener =>
  async (req, res) => {
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
        host: deps.host,
        port: deps.port,
      });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/clients/register') {
      const setupToken =
        typeof req.headers['x-iki-setup-token'] === 'string' ? req.headers['x-iki-setup-token'] : '';
      if (deps.bootstrapTokenRef.current && setupToken !== deps.bootstrapTokenRef.current) {
        writeJson(res, 401, { success: false, error: 'Invalid setup token' });
        return;
      }

      try {
        const isFirstClient = isFirstUserClientRegistration(deps.napcatClientId);
        const body = parseClientRegistrationPayload(await parseJsonBody(req));

        const created = createAppClient(body);
        if (isFirstClient) {
          chatThreadDb.assignClientToLegacyThreads(created.client.id);
        }
        deps.bootstrapTokenRef.current = rotateBootstrapToken(deps.userDataPath);
        writeJson(res, 200, {
          success: true,
          client_id: created.client.id,
          token: created.token,
          scopes: created.client.scopes,
          allowed_tools: created.client.allowedTools,
        });
        return;
      } catch {
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
      const threads = deps.chatService.listThreads().filter(thread => thread.client_id === client.id);
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
        const body = parseChatThreadCreatePayload(await parseJsonBody(req));
        const thread = deps.chatService.createThread({
          ...(body || {}),
          client_id: client.id,
        });
        writeJson(res, 200, { success: true, thread });
        return;
      } catch {
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
      const messages = deps.chatService.listMessages(threadId);
      writeJson(res, 200, { success: true, messages });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/chat/send') {
      if (!hasScope(client, 'chat:write')) {
        writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
        return;
      }
      try {
        const body = parseChatSendPayload(await parseJsonBody(req));
        const threadId = body.threadId;
        if (threadId) {
          const access = getThreadOrError(threadId, client.id);
          if (!access.thread) {
            writeJson(res, access.status || 404, { success: false, error: access.error });
            return;
          }
        }

        const messages = body.messages as ChatTransportMessage[];
        const tools = resolveToolsForClient(body.tools, client.allowedTools);
        const requestedMcpServerIds = readRequestedMcpServerIds(body);
        const mcpServerIds = resolveMcpServerIdsForClient(
          requestedMcpServerIds,
          client.allowedTools
        );
        if ((tools.length > 0 || mcpServerIds.length > 0) && !hasScope(client, 'tools:run')) {
          writeJson(res, 403, { success: false, error: 'Missing tools:run scope' });
          return;
        }

        const result = await deps.chatService.send({
          providerType: body.providerType,
          model: body.model,
          messages,
          tools,
          mcpServerIds,
          skillIds: body.skillIds,
          skillMode: body.skillMode,
          threadId,
        });

        writeJson(res, 200, result);
        return;
      } catch {
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
        const body = parseApproveToolPayload(await parseJsonBody(req));
        const connectionId =
          typeof body.connectionId === 'number'
            ? body.connectionId
            : typeof req.headers['x-iki-connection'] === 'string'
              ? Number(req.headers['x-iki-connection'])
              : null;

        const session = connectionId ? deps.sessions.get(connectionId) : null;
        if (!session || session.client.id !== client.id) {
          writeJson(res, 400, { success: false, error: 'Missing or invalid connection_id' });
          return;
        }

        const result = await deps.chatService.approveTool(
          session.webContents,
          body.approvalId,
          body.approved
        );
        writeJson(res, 200, result);
        return;
      } catch {
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
      const session = deps.sessions.get(connectionId);
      if (!session || session.client.id !== client.id) {
        writeJson(res, 400, { success: false, error: 'Invalid connection_id' });
        return;
      }
      const result = deps.chatService.stopStream(connectionId);
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
        const body = parseMemorySearchPayload(await parseJsonBody(req));
        const results = memoryDb.searchLongMemoryAcrossThreads(body.query, {
          limit: body.limit,
          threshold: body.threshold,
          includeIncognito: body.includeIncognito,
          clientId: client.id,
        });
        writeJson(res, 200, { success: true, results });
        return;
      } catch {
        writeJson(res, 400, { success: false, error: 'Invalid search payload' });
        return;
      }
    }

    if (req.method === 'GET' && pathName === '/v1/mcp/servers') {
      if (!hasScope(client, 'mcp:read')) {
        writeJson(res, 403, { success: false, error: 'Missing mcp:read scope' });
        return;
      }
      const servers = deps.mcpManager.listServers();
      writeJson(res, 200, { success: true, servers });
      return;
    }

    if (req.method === 'POST' && pathName === '/v1/mcp/servers') {
      if (!hasScope(client, 'mcp:write')) {
        writeJson(res, 403, { success: false, error: 'Missing mcp:write scope' });
        return;
      }
      try {
        const body = parseMcpServerCreatePayload(await parseJsonBody(req));
        const created = await deps.mcpManager.addServer(body);
        writeJson(res, 200, { success: true, server: created });
        return;
      } catch (error) {
        writeJson(res, 400, {
          success: false,
          error: getSchemaErrorMessage(error, 'Invalid MCP server payload'),
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
          const status = await deps.mcpManager.connectServer(serverId);
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
        await deps.mcpManager.disconnectServer(serverId);
        writeJson(res, 200, { success: true });
        return;
      }

      if (action === 'refresh-tools') {
        if (!hasScope(client, 'mcp:read')) {
          writeJson(res, 403, { success: false, error: 'Missing mcp:read scope' });
          return;
        }
        try {
          const tools = await deps.mcpManager.refreshTools(serverId);
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
        await deps.mcpManager.deleteServer(serverId);
        writeJson(res, 200, { success: true });
        return;
      }

      if (!action) {
        if (!hasScope(client, 'mcp:write')) {
          writeJson(res, 403, { success: false, error: 'Missing mcp:write scope' });
          return;
        }
        try {
          const body = parseMcpServerUpdatePayload(await parseJsonBody(req));
          const updated = await deps.mcpManager.updateServer(serverId, body);
          writeJson(res, 200, { success: true, server: updated });
        } catch (error) {
          writeJson(res, 400, {
            success: false,
            error: getSchemaErrorMessage(error, 'Invalid MCP server update'),
          });
        }
        return;
      }
    }

    writeJson(res, 404, { success: false, error: 'Not found' });
  };
