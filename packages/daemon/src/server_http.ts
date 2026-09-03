import http from 'node:http';

import * as memoryDb from '@iki/backend/db/memory';
import { createAppClient } from '@iki/backend/db/app_clients';
import type { McpManager } from '@iki/backend/mcp';
import type { ChatTransportMessage } from '@iki/backend/chat_service';
import type { ChatService } from '@iki/backend/chat_service';
import type { NapCatBridgeStatusInfo } from '@iki/backend/types/config';
import { rotateBootstrapToken } from './bootstrap_token';
import {
  logDaemonHandlerFailure,
  type DaemonServerLogger,
  writeClientPayloadFailure,
} from './server_logging';
import {
  readRequestedMcpServerIds,
  resolveMcpServerIdsForClient,
  resolveToolsForClient,
} from './tool_access';
import {
  getSchemaErrorMessage,
  type ApproveToolPayload,
  type ChatMessageCreatePayload,
  type ChatSendPayload,
  type ChatThreadCreatePayload,
  type ClientRegistrationPayload,
  type MemorySearchPayload,
  parseApproveToolPayload,
  parseChatMessageCreatePayload,
  parseChatSendPayload,
  parseChatThreadCreatePayload,
  parseClientRegistrationPayload,
  parseMcpServerCreatePayload,
  parseMcpServerUpdatePayload,
  parseMemorySearchPayload,
} from './server_schemas';
import { createRateLimiter } from '@iki/backend/rate_limiter';
import {
  authenticateRequest,
  getThreadOrError,
  hasScope,
  parseJsonBody,
  type WsSession,
  withCors,
  writeJson,
} from './server_shared';

type CreateDaemonRequestHandlerDeps = {
  host: string;
  port: number;
  userDataPath: string;
  bootstrapTokenRef: { current: string };
  napcatClientId: string;
  getNapCatBridgeStatus: () => NapCatBridgeStatusInfo;
  chatService: ChatService;
  mcpManager: McpManager;
  sessions: Map<number, WsSession>;
  logger: DaemonServerLogger;
};

const readParsedBody = async <T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parser: (value: unknown) => T,
  invalidMessage: string
): Promise<T | null> => {
  try {
    return parser(await parseJsonBody(req));
  } catch (error) {
    writeClientPayloadFailure(res, error, invalidMessage);
    return null;
  }
};

export const createDaemonRequestHandler =
  (deps: CreateDaemonRequestHandlerDeps): http.RequestListener => {
    const chatSendLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

    const checkRateLimit = (
      clientId: string,
      limiter: ReturnType<typeof createRateLimiter>,
      res: http.ServerResponse
    ): boolean => {
      const result = limiter.check(clientId);
      if (!result.allowed) {
        res.setHeader('Retry-After', Math.ceil((result.retryAfterMs ?? 1000) / 1000));
        writeJson(res, 429, {
          success: false,
          error: 'Too many requests',
        });
        return false;
      }
      return true;
    };

    return async (req, res) => {
    withCors(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathName = url.pathname;
    let clientId: string | undefined;

    try {
      if (req.method === 'GET' && pathName === '/v1/health') {
        writeJson(res, 200, {
          success: true,
          status: 'ok',
          uptime: process.uptime(),
          host: deps.host,
          port: deps.port,
          bridges: {
            napcat: deps.getNapCatBridgeStatus(),
          },
        });
        return;
      }

      if (req.method === 'POST' && pathName === '/v1/clients/register') {
        const setupToken =
          typeof req.headers['x-iki-setup-token'] === 'string'
            ? req.headers['x-iki-setup-token']
            : '';
        if (deps.bootstrapTokenRef.current && setupToken !== deps.bootstrapTokenRef.current) {
          writeJson(res, 401, { success: false, error: 'Invalid setup token' });
          return;
        }

        const body = await readParsedBody<ClientRegistrationPayload>(
          req,
          res,
          parseClientRegistrationPayload,
          'Invalid registration payload'
        );
        if (!body) return;

        const created = createAppClient(body);
        deps.bootstrapTokenRef.current = rotateBootstrapToken(deps.userDataPath);
        writeJson(res, 200, {
          success: true,
          client_id: created.client.id,
          token: created.token,
          scopes: created.client.scopes,
          allowed_tools: created.client.allowedTools,
        });
        return;
      }

      const auth = authenticateRequest(req);
      if (!auth.client) {
        writeJson(res, 401, { success: false, error: auth.error || 'Unauthorized' });
        return;
      }

      const client = auth.client;
      clientId = client.id;

      if (req.method === 'GET' && pathName === '/v1/chat/threads') {
        if (!hasScope(client, 'chat:read')) {
          writeJson(res, 403, { success: false, error: 'Missing chat:read scope' });
          return;
        }
        const threads = deps.chatService
          .listThreads()
          .filter(thread => thread.client_id === client.id);
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
        const body = await readParsedBody<ChatThreadCreatePayload>(
          req,
          res,
          parseChatThreadCreatePayload,
          'Invalid thread payload'
        );
        if (!body) return;

        const thread = deps.chatService.createThread({
          ...body,
          client_id: client.id,
        });
        writeJson(res, 200, { success: true, thread });
        return;
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

      if (req.method === 'POST' && pathName === '/v1/chat/messages') {
        if (!hasScope(client, 'chat:write')) {
          writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
          return;
        }
        const body = await readParsedBody<ChatMessageCreatePayload>(
          req,
          res,
          parseChatMessageCreatePayload,
          'Invalid chat message payload'
        );
        if (!body) return;

        const access = getThreadOrError(body.threadId, client.id);
        if (!access.thread) {
          writeJson(res, access.status || 404, { success: false, error: access.error });
          return;
        }

        const message = await deps.chatService.createMessageWithProcessing?.(
          {
            thread_id: body.threadId,
            message: {
              role: body.role,
              content: body.content,
            },
            ...(typeof body.timestamp === 'string' && body.timestamp.trim()
              ? { timestamp: body.timestamp.trim() }
              : {}),
            ...(body.metadata !== undefined
              ? {
                  metadata:
                    typeof body.metadata === 'string'
                      ? body.metadata
                      : JSON.stringify(body.metadata),
                }
              : {}),
          },
          { waitForEmotionAnalysis: body.awaitEmotionAnalysis }
        );

        writeJson(res, 200, { success: true, message });
        return;
      }

      if (req.method === 'POST' && pathName === '/v1/chat/send') {
        if (!hasScope(client, 'chat:write')) {
          writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
          return;
        }
        if (!checkRateLimit(clientId, chatSendLimiter, res)) return;
        const body = await readParsedBody<ChatSendPayload>(
          req,
          res,
          parseChatSendPayload,
          'Invalid chat payload'
        );
        if (!body) return;

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
          experimentalContext: body.experimentalContext,
        });

        writeJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathName === '/v1/chat/approve-tool') {
        if (!hasScope(client, 'tools:approve')) {
          writeJson(res, 403, { success: false, error: 'Missing tools:approve scope' });
          return;
        }
        const body = await readParsedBody<ApproveToolPayload>(
          req,
          res,
          parseApproveToolPayload,
          'Invalid approval payload'
        );
        if (!body) return;

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
          session.target,
          body.approvalId,
          body.approved
        );
        writeJson(res, 200, result);
        return;
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

      if (req.method === 'GET' && pathName === '/v1/chat/runs') {
        if (!hasScope(client, 'chat:read')) {
          writeJson(res, 403, { success: false, error: 'Missing chat:read scope' });
          return;
        }
        const statusParam = url.searchParams.get('status') || '';
        const statuses = statusParam
          ? statusParam.split(',').map(s => s.trim()).filter(Boolean)
          : [];
        const limit = Number(url.searchParams.get('limit') || '');
        const runs = deps.chatService.listRunsByStatus(
          statuses.length > 0 ? (statuses as import('@iki/backend/types/agent_run').AgentRunStatus[]) : ['queued', 'running', 'blocked', 'completed', 'failed', 'cancelled'],
          {
            clientId: client.id,
            ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
          }
        );
        writeJson(res, 200, { success: true, runs: runs.map(run => ({ ...run })) });
        return;
      }

      const runActionMatch = pathName.match(/^\/v1\/chat\/runs\/([^/]+)\/(cancel|retry|resume)$/);
      if (req.method === 'POST' && runActionMatch) {
        const runId = runActionMatch[1];
        const action = runActionMatch[2];

        if (action === 'cancel') {
          if (!hasScope(client, 'chat:write')) {
            writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
            return;
          }
          const result = deps.chatService.cancelRun(runId);
          writeJson(res, 200, result);
          return;
        }

        if (action === 'retry') {
          if (!hasScope(client, 'chat:write')) {
            writeJson(res, 403, { success: false, error: 'Missing chat:write scope' });
            return;
          }
          const connectionId =
            typeof req.headers['x-iki-connection'] === 'string'
              ? Number(req.headers['x-iki-connection'])
              : null;
          if (connectionId && !Number.isNaN(connectionId)) {
            const session = deps.sessions.get(connectionId);
            if (session && session.client.id === client.id) {
              const result = await deps.chatService.retryAndExecute(session.target, runId);
              writeJson(res, 200, result);
              return;
            }
          }
          const result = deps.chatService.retryRun(runId);
          writeJson(res, 200, result);
          return;
        }

        if (action === 'resume') {
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
          const result = await deps.chatService.resumeRun(session.target, runId);
          writeJson(res, 200, result);
          return;
        }
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
        const body = await readParsedBody<MemorySearchPayload>(
          req,
          res,
          parseMemorySearchPayload,
          'Invalid search payload'
        );
        if (!body) return;

        const results = await memoryDb.searchLongMemoryAcrossThreads(body.query, {
          limit: body.limit,
          threshold: body.threshold,
          includeIncognito: body.includeIncognito,
          clientId: client.id,
        });
        writeJson(res, 200, { success: true, results });
        return;
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
        const body = await readParsedBody(
          req,
          res,
          parseMcpServerCreatePayload,
          'Invalid MCP server payload'
        );
        if (!body) return;

        try {
          const created = await deps.mcpManager.addServer(body);
          writeJson(res, 200, { success: true, server: created });
          return;
        } catch (error) {
          writeJson(res, 400, {
            success: false,
            error: getSchemaErrorMessage(error, 'Failed to create MCP server'),
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
          const body = await readParsedBody(
            req,
            res,
            parseMcpServerUpdatePayload,
            'Invalid MCP server update'
          );
          if (!body) return;

          try {
            const updated = await deps.mcpManager.updateServer(serverId, body);
            writeJson(res, 200, { success: true, server: updated });
          } catch (error) {
            writeJson(res, 400, {
              success: false,
              error: getSchemaErrorMessage(error, 'Failed to update MCP server'),
            });
          }
          return;
        }
      }

      writeJson(res, 404, { success: false, error: 'Not found' });
    } catch (error) {
      logDaemonHandlerFailure({
        logger: deps.logger,
        event: 'daemon.server.http.request',
        message: 'Daemon HTTP request failed unexpectedly.',
        error,
        data: {
          method: req.method || 'GET',
          path: pathName,
          ...(clientId ? { client_id: clientId } : {}),
        },
      });
      writeJson(res, 500, { success: false, error: 'Internal server error' });
    }
  };
};
