import http from 'node:http';

import type { ChatService } from '@iki/backend/chat_service';
import type { ChatTransportMessage } from '@iki/backend/chat_service';
import { logDaemonHandlerFailure, type DaemonServerLogger } from './server_logging';
import {
  readRequestedMcpServerIds,
  resolveMcpServerIdsForClient,
  resolveToolsForClient,
} from './tool_access';
import { parseDaemonWebSocketMessage } from './server_schemas';
import {
  authenticateWebSocket,
  getThreadOrError,
  hasScope,
  type DaemonSocket,
  type DaemonSocketServer,
  type WsSession,
} from './server_shared';

type NapCatBridgeLike = {
  handleUpgrade: (req: http.IncomingMessage, socket: unknown, head: Buffer) => boolean;
};

type ConfigureDaemonWebSocketsDeps = {
  server: http.Server;
  wss: DaemonSocketServer;
  chatService: ChatService;
  napcatBridge: NapCatBridgeLike;
  sessions: Map<number, WsSession>;
  wsSessions: Map<DaemonSocket, WsSession>;
  nextSessionIdRef: { current: number };
  logger: DaemonServerLogger;
};

const SOCKET_OPEN = 1;

const sendDaemonPayload = (ws: DaemonSocket, payload: Record<string, unknown>) => {
  if (ws.readyState !== SOCKET_OPEN) return;
  ws.send(
    JSON.stringify({
      channel: 'daemon',
      payload,
    })
  );
};

const sendDaemonError = (ws: DaemonSocket, error: string) => {
  sendDaemonPayload(ws, { type: 'error', error });
};

const logWsFailure = (deps: ConfigureDaemonWebSocketsDeps, session: WsSession, input: {
  error: unknown;
  message: string;
  messageType: 'start' | 'approve-tool' | 'stop' | 'steer';
  requestId?: unknown;
}) => {
  logDaemonHandlerFailure({
    logger: deps.logger,
    event: 'daemon.server.ws.message',
    message: input.message,
    error: input.error,
    data: {
      connection_id: session.id,
      client_id: session.client.id,
      message_type: input.messageType,
      ...(input.requestId !== undefined ? { request_id: String(input.requestId) } : {}),
    },
  });
};

export const configureDaemonWebSockets = (deps: ConfigureDaemonWebSocketsDeps) => {
  deps.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/v1/chat/stream') {
      const auth = authenticateWebSocket(req);
      if (!auth.client) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      deps.wss.handleUpgrade(req, socket, head, ws => {
        const id = deps.nextSessionIdRef.current++;
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
          client: auth.client,
          webContents,
        };
        deps.sessions.set(id, session);
        deps.wsSessions.set(ws, session);

        ws.on('close', () => {
          deps.sessions.delete(id);
          deps.wsSessions.delete(ws);
        });

        ws.on('error', () => {
          deps.sessions.delete(id);
          deps.wsSessions.delete(ws);
        });

        sendDaemonPayload(ws, { type: 'ready', connection_id: id });
        deps.wss.emit('connection', ws, req);
      });
      return;
    }

    if (deps.napcatBridge.handleUpgrade(req, socket, head)) {
      return;
    }

    socket.destroy();
  });

  deps.wss.on('connection', ws => {
    const session = deps.wsSessions.get(ws);
    if (!session) return;

    ws.on('message', async (data: unknown) => {
      let parsed: ReturnType<typeof parseDaemonWebSocketMessage>;
      try {
        parsed = parseDaemonWebSocketMessage(JSON.parse(String(data)));
      } catch {
        sendDaemonError(ws, 'Invalid message payload');
        return;
      }

      if (parsed.type === 'start') {
        if (!hasScope(session.client, 'chat:write')) {
          sendDaemonError(ws, 'Missing chat:write scope');
          return;
        }

        const payload = parsed.payload;
        const threadId = payload.threadId;
        if (threadId) {
          const access = getThreadOrError(threadId, session.client.id);
          if (!access.thread) {
            sendDaemonError(ws, access.error || 'Thread not found');
            return;
          }
        }

        const messages = payload.messages as ChatTransportMessage[];
        const tools = resolveToolsForClient(payload.tools, session.client.allowedTools);
        const requestedMcpServerIds = readRequestedMcpServerIds(payload);
        const mcpServerIds = resolveMcpServerIdsForClient(
          requestedMcpServerIds,
          session.client.allowedTools
        );
        if ((tools.length > 0 || mcpServerIds.length > 0) && !hasScope(session.client, 'tools:run')) {
          sendDaemonError(ws, 'Missing tools:run scope');
          return;
        }

        try {
          const result = await deps.chatService.stream(session.webContents, {
            providerType: payload.providerType,
            model: payload.model,
            messages,
            tools,
            mcpServerIds,
            skillIds: payload.skillIds,
            skillMode: payload.skillMode,
            threadId,
            maxIterations: payload.maxIterations,
            experimentalContext: payload.experimentalContext,
            autonomous: payload.autonomous,
            runConfig: payload.runConfig,
          });

          sendDaemonPayload(ws, {
            type: 'stream-result',
            request_id: parsed.request_id || null,
            ...result,
          });
        } catch (error) {
          logWsFailure(deps, session, {
            error,
            message: 'Daemon WebSocket start request failed unexpectedly.',
            messageType: 'start',
            requestId: parsed.request_id,
          });
          sendDaemonError(ws, 'Failed to start stream');
        }
        return;
      }

      if (parsed.type === 'approve-tool') {
        if (!hasScope(session.client, 'tools:approve')) {
          sendDaemonError(ws, 'Missing tools:approve scope');
          return;
        }

        try {
          const result = await deps.chatService.approveTool(
            session.webContents,
            parsed.approval_id,
            parsed.approved
          );
          sendDaemonPayload(ws, {
            type: 'approve-result',
            approval_id: parsed.approval_id,
            ...result,
          });
        } catch (error) {
          logWsFailure(deps, session, {
            error,
            message: 'Daemon WebSocket tool approval failed unexpectedly.',
            messageType: 'approve-tool',
          });
          sendDaemonError(ws, 'Failed to approve tool request');
        }
        return;
      }

      if (parsed.type === 'steer') {
        if (!hasScope(session.client, 'chat:write')) {
          sendDaemonError(ws, 'Missing chat:write scope');
          return;
        }

        try {
          const result = deps.chatService.steerStream(session.webContents.id, parsed.message);
          sendDaemonPayload(ws, { type: 'steer-result', ...result });
        } catch (error) {
          logWsFailure(deps, session, {
            error,
            message: 'Daemon WebSocket steer request failed unexpectedly.',
            messageType: 'steer',
          });
          sendDaemonError(ws, 'Failed to steer stream');
        }
        return;
      }

      try {
        const result = deps.chatService.stopStream(session.webContents.id);
        sendDaemonPayload(ws, { type: 'stop-result', ...result });
      } catch (error) {
        logWsFailure(deps, session, {
          error,
          message: 'Daemon WebSocket stop request failed unexpectedly.',
          messageType: 'stop',
        });
        sendDaemonError(ws, 'Failed to stop stream');
      }
    });
  });
};
