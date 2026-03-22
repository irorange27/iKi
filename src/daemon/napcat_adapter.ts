import type http from 'node:http';
import { createRequire } from 'node:module';

import type { ChatService } from '../main/services/chat/chat_service';
import { parseStoredUiMessageRow } from '../main/services/chat/chat_ui';
import type { ChatTransportMessage } from '../main/services/chat/chat_types';
import { getAppConfig } from '../core/config';
import { createDaemonLogger } from '../core/daemon_logs';
import { getProviders } from '../core/db/providers';
import type { ChatThread } from '../shared/types/chat';
import { parseModelList } from '../shared/utils/provider_models';
import { isObjectRecord } from '../shared/utils/guards';
import type { ParsedUiMessage } from '../shared/chat/ui_message_codec';
import { registerBridgeThreadSender } from './bridge_dispatch';

type ReverseBridgeSocket = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

type ReverseBridgeSocketServer = {
  handleUpgrade: (
    req: http.IncomingMessage,
    socket: unknown,
    head: Buffer,
    callback: (ws: ReverseBridgeSocket) => void
  ) => void;
  on: (
    event: 'connection',
    listener: (ws: ReverseBridgeSocket, req: http.IncomingMessage) => void
  ) => void;
  emit: (event: 'connection', ws: ReverseBridgeSocket, req: http.IncomingMessage) => boolean;
};

const nodeRequire = createRequire(__filename);

const { WebSocketServer } = nodeRequire('ws') as {
  WebSocketServer: new (options: { noServer: boolean }) => ReverseBridgeSocketServer;
};

const napcatLogger = createDaemonLogger({ module: 'napcat' });

type NapCatMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

type NapCatMessageEvent = {
  post_type?: string;
  message_type?: 'private' | 'group';
  sub_type?: string;
  user_id?: number | string;
  group_id?: number | string;
  self_id?: number | string;
  message_id?: number | string;
  message?: string | NapCatMessageSegment[];
  raw_message?: string;
  sender?: Record<string, unknown>;
};

type NapCatActionResponse = {
  status?: string;
  retcode?: number;
  data?: unknown;
  echo?: string | number;
};

type NapCatBridgeOptions = {
  chatService: ChatService;
  clientId: string;
};

type NapCatThreadTarget = {
  messageType: 'private' | 'group';
  userId?: string;
  groupId?: string;
};

type PendingAction = {
  action: string;
  resolve: (value: NapCatActionResponse) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

const DEFAULT_SYSTEM_PROMPT = [
  'You are iKi, responding to QQ messages via NapCat.',
  'Keep replies concise and helpful.',
].join(' ');

const isSuccessfulActionResponse = (payload: NapCatActionResponse): boolean => {
  if (typeof payload.retcode === 'number') {
    if (payload.retcode !== 0) return false;
  } else {
    return false;
  }

  if (typeof payload.status === 'string' && payload.status.trim()) {
    return payload.status.trim().toLowerCase() === 'ok';
  }

  return true;
};

const buildActionFailureMessage = (action: string, payload: NapCatActionResponse): string => {
  const status =
    typeof payload.status === 'string' && payload.status.trim()
      ? payload.status.trim()
      : 'unknown';
  const retcode =
    typeof payload.retcode === 'number' && Number.isFinite(payload.retcode)
      ? String(payload.retcode)
      : 'unknown';

  return `NapCat action ${action} failed (status=${status}, retcode=${retcode})`;
};

const parseToken = (req: http.IncomingMessage): string | null => {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();

  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const tokenParam = url.searchParams.get('access_token') || url.searchParams.get('token');
  return tokenParam ? tokenParam.trim() : null;
};

const getRemoteLabel = (req: http.IncomingMessage): string => {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedText =
    typeof forwarded === 'string'
      ? forwarded
      : Array.isArray(forwarded)
        ? forwarded[0] || ''
        : '';
  const forwardedIp = forwardedText.split(',')[0]?.trim();
  if (forwardedIp) return forwardedIp;

  const socketIp = req.socket?.remoteAddress || '';
  const socketPort = req.socket?.remotePort;
  if (!socketIp) return 'unknown';
  return typeof socketPort === 'number' ? `${socketIp}:${socketPort}` : socketIp;
};

const normalizeId = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseMessageText = (
  message: NapCatMessageEvent['message'],
  rawMessage: string | undefined,
  selfId: string
): { text: string; mentionedSelf: boolean } => {
  if (typeof message === 'string') {
    const text = message.trim();
    return { text, mentionedSelf: text.includes(`@${selfId}`) };
  }

  if (!Array.isArray(message)) {
    const fallback = typeof rawMessage === 'string' ? rawMessage.trim() : '';
    return { text: fallback, mentionedSelf: fallback.includes(`@${selfId}`) };
  }

  let text = '';
  let mentionedSelf = false;
  for (const segment of message) {
    if (!segment || typeof segment !== 'object') continue;
    const type = typeof segment.type === 'string' ? segment.type : '';
    const data = isObjectRecord(segment.data) ? segment.data : {};

    if (type === 'text') {
      const part = typeof data.text === 'string' ? data.text : '';
      text += part;
      continue;
    }

    if (type === 'at') {
      const qq = data.qq;
      const qqText = qq === 'all' ? '@all ' : `@${qq} `;
      text += qqText;
      if (normalizeId(qq) === selfId) {
        mentionedSelf = true;
      }
      continue;
    }

    if (type === 'image') {
      text += '[image]';
      continue;
    }
  }

  const trimmed = text.trim();
  if (!trimmed && typeof rawMessage === 'string') {
    return { text: rawMessage.trim(), mentionedSelf: rawMessage.includes(`@${selfId}`) };
  }
  return { text: trimmed, mentionedSelf };
};

type NapCatRuntimeConfig = {
  enabled: boolean;
  accessToken: string;
  providerType: string;
  model: string;
  tools: string[];
  requireMention: boolean;
};

const getNapCatConfig = (): NapCatRuntimeConfig => {
  const appConfig = getAppConfig();
  const config = appConfig.bridges?.napcat;
  const envTools = process.env.IKI_NAPCAT_TOOLS
    ? process.env.IKI_NAPCAT_TOOLS.split(',')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

  return {
    enabled: Boolean(config?.enabled),
    accessToken:
      config?.accessToken?.trim() ||
      process.env.IKI_NAPCAT_ACCESS_TOKEN?.trim() ||
      process.env.IKI_NAPCAT_TOKEN?.trim() ||
      '',
    providerType: config?.providerType?.trim() || process.env.IKI_NAPCAT_PROVIDER?.trim() || '',
    model: config?.model?.trim() || process.env.IKI_NAPCAT_MODEL?.trim() || '',
    tools:
      (Array.isArray(config?.tools) ? config.tools.map(item => item.trim()).filter(Boolean) : [])
        .concat(
          Array.isArray(config?.tools) && config.tools.length > 0 ? [] : envTools
        )
        .filter((item, index, items) => items.indexOf(item) === index),
    requireMention:
      typeof config?.requireMention === 'boolean'
        ? config.requireMention
        : String(process.env.IKI_NAPCAT_REQUIRE_MENTION || '').toLowerCase() === 'true',
  };
};

const resolveNapCatModel = (
  config: Pick<NapCatRuntimeConfig, 'providerType' | 'model'>
): { providerType: string; model: string } | null => {
  const providerOverride = config.providerType;
  const modelOverride = config.model;

  const providers = getProviders().filter(provider => provider.enabled);
  if (providers.length === 0) return null;

  const provider =
    providerOverride && providers.find(p => p.type === providerOverride)
      ? providers.find(p => p.type === providerOverride)
      : providers[0];

  if (!provider) return null;
  const models = parseModelList(provider.models);
  const model = modelOverride || models[0] || '';

  if (!model) return null;
  return { providerType: provider.type, model };
};

const buildSystemMessage = (event: NapCatMessageEvent): Record<string, unknown> => {
  const selfId = normalizeId(event.self_id);
  const userId = normalizeId(event.user_id);
  const groupId = normalizeId(event.group_id);
  const messageType = event.message_type || 'unknown';

  const lines = [
    DEFAULT_SYSTEM_PROMPT,
    `Context: message_type=${messageType}`,
    selfId ? `self_id=${selfId}` : '',
    userId ? `user_id=${userId}` : '',
    groupId ? `group_id=${groupId}` : '',
  ].filter(Boolean);

  return {
    role: 'system',
    parts: [{ type: 'text', text: lines.join('\n') }],
  };
};

const buildUserMessage = (text: string): Record<string, unknown> => ({
  role: 'user',
  parts: [{ type: 'text', text }],
});

const buildAssistantMessage = (text: string): Record<string, unknown> => ({
  role: 'assistant',
  parts: [{ type: 'text', text }],
});

const buildThreadTitle = (event: NapCatMessageEvent): string => {
  const messageType = event.message_type || 'unknown';
  if (messageType === 'group') {
    return `QQ Group ${normalizeId(event.group_id)}`;
  }
  if (messageType === 'private') {
    return `QQ User ${normalizeId(event.user_id)}`;
  }
  return 'QQ Chat';
};

const buildThreadId = (event: NapCatMessageEvent): string => {
  const selfId = normalizeId(event.self_id) || 'self';
  const messageType = event.message_type || 'unknown';
  const targetId =
    messageType === 'group' ? normalizeId(event.group_id) : normalizeId(event.user_id);
  return `napcat_${selfId}_${messageType}_${targetId || 'unknown'}`;
};

const parseNapCatThreadTarget = (
  thread: Pick<ChatThread, 'id' | 'client_id' | 'metadata'>
): NapCatThreadTarget | null => {
  let metadata: Record<string, unknown> = {};

  if (typeof thread.metadata === 'string' && thread.metadata.trim()) {
    try {
      const parsed = JSON.parse(thread.metadata);
      metadata = isObjectRecord(parsed) ? parsed : {};
    } catch {
      metadata = {};
    }
  }

  const source = typeof metadata.source === 'string' ? metadata.source.trim() : '';
  const messageType =
    metadata.message_type === 'group'
      ? 'group'
      : metadata.message_type === 'private'
        ? 'private'
        : '';
  const userId =
    typeof metadata.user_id === 'string' || typeof metadata.user_id === 'number'
      ? normalizeId(metadata.user_id)
      : '';
  const groupId =
    typeof metadata.group_id === 'string' || typeof metadata.group_id === 'number'
      ? normalizeId(metadata.group_id)
      : '';

  if (source === 'napcat' && messageType === 'private' && userId) {
    return { messageType, userId };
  }

  if (source === 'napcat' && messageType === 'group' && groupId) {
    return { messageType, groupId };
  }

  if (thread.client_id === 'client_napcat' || thread.id.startsWith('napcat_')) {
    const match = thread.id.match(/^napcat_[^_]+_(private|group)_(.+)$/);
    if (!match) return null;

    const [, parsedType, targetId] = match;
    if (parsedType === 'private') {
      return { messageType: 'private', userId: targetId };
    }
    return { messageType: 'group', groupId: targetId };
  }

  return null;
};

export const createNapCatReverseBridge = (options: NapCatBridgeOptions) => {
  const wss = new WebSocketServer({ noServer: true });
  const pendingActions = new Map<string, PendingAction>();
  const activeSockets: ReverseBridgeSocket[] = [];
  let nextEcho = 1;

  const sendAction = (ws: ReverseBridgeSocket, action: string, params: Record<string, unknown>) =>
    new Promise<NapCatActionResponse>((resolve, reject) => {
      const echo = `napcat_${Date.now()}_${nextEcho++}`;
      const timeout = setTimeout(() => {
        pendingActions.delete(echo);
        reject(new Error('NapCat action timeout'));
      }, 10000);

      pendingActions.set(echo, { action, resolve, reject, timeout });
      ws.send(JSON.stringify({ action, params, echo }));
    });

  const getActiveSocket = (): ReverseBridgeSocket | null => {
    for (let index = activeSockets.length - 1; index >= 0; index -= 1) {
      const socket = activeSockets[index];
      if (socket?.readyState === 1) return socket;
    }
    return null;
  };

  const removeActiveSocket = (ws: ReverseBridgeSocket) => {
    const index = activeSockets.indexOf(ws);
    if (index >= 0) {
      activeSockets.splice(index, 1);
    }
  };

  const sendThreadMessage = async (params: { thread: ChatThread; text: string }) => {
    const napcatConfig = getNapCatConfig();
    if (!napcatConfig.enabled) {
      throw new Error('NapCat bridge is disabled');
    }

    const target = parseNapCatThreadTarget(params.thread);
    if (!target) {
      throw new Error('Thread is not a valid NapCat conversation');
    }

    const message = params.text.trim();
    if (!message) {
      throw new Error('Cannot send an empty NapCat message');
    }

    const ws = getActiveSocket();
    if (!ws) {
      throw new Error('NapCat bridge is not connected');
    }

    if (target.messageType === 'private') {
      await sendAction(ws, 'send_private_msg', {
        user_id: target.userId,
        message,
      });
      return;
    }

    await sendAction(ws, 'send_group_msg', {
      group_id: target.groupId,
      message,
    });
  };

  const unregisterBridgeThreadSender = registerBridgeThreadSender('napcat', sendThreadMessage);

  const handleActionResponse = (payload: NapCatActionResponse) => {
    if (!payload.echo) return false;
    const echo = String(payload.echo);
    const pending = pendingActions.get(echo);
    if (!pending) return true;
    clearTimeout(pending.timeout);
    pendingActions.delete(echo);

    if (isSuccessfulActionResponse(payload)) {
      pending.resolve(payload);
      return true;
    }

    pending.reject(new Error(buildActionFailureMessage(pending.action, payload)));
    return true;
  };

  const handleIncomingMessage = async (event: NapCatMessageEvent, ws: ReverseBridgeSocket) => {
    if (event.post_type !== 'message') return;
    if (event.message_type !== 'private' && event.message_type !== 'group') return;

    const selfId = normalizeId(event.self_id);
    const userId = normalizeId(event.user_id);
    if (selfId && userId && selfId === userId) return;

    const napcatConfig = getNapCatConfig();
    if (!napcatConfig.enabled) return;

    const { text, mentionedSelf } = parseMessageText(event.message, event.raw_message, selfId);
    if (!text) return;
    if (napcatConfig.requireMention && event.message_type === 'group' && !mentionedSelf) return;

    const modelConfig = resolveNapCatModel(napcatConfig);
    if (!modelConfig) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.message.handle',
        outcome: 'skipped',
        message: 'No provider/model configured; ignoring inbound message.',
      });
      return;
    }

    const threadId = buildThreadId(event);
    const existingThread = options.chatService.getThread(threadId);
    if (!existingThread) {
      options.chatService.createThread({
        id: threadId,
        title: buildThreadTitle(event),
        metadata: JSON.stringify({
          source: 'napcat',
          message_type: event.message_type,
          self_id: event.self_id,
          group_id: event.group_id,
          user_id: event.user_id,
        }),
        client_id: options.clientId,
      });
    }

    try {
      options.chatService.createMessage({
        thread_id: threadId,
        message: buildUserMessage(text),
        metadata: '{}',
      });
    } catch (error) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.message.persist',
        outcome: 'failed',
        error,
        entity: {
          thread_id: threadId,
          role: 'user',
        },
      });
    }

    const rows = options.chatService.listMessages(threadId);
    const uiMessages = rows.map(row =>
      parseStoredUiMessageRow({ id: row.id, message: row.message })
    );
    const messages: Array<Record<string, unknown> | ParsedUiMessage> = [
      buildSystemMessage(event),
      ...uiMessages,
    ];

    const result = await options.chatService.send({
      providerType: modelConfig.providerType,
      model: modelConfig.model,
      messages: messages as unknown as ChatTransportMessage[],
      tools: napcatConfig.tools,
      threadId,
    });

    if (!result.success || !result.text) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.reply.generate',
        outcome: 'failed',
        error: result.error,
        entity: {
          thread_id: threadId,
        },
      });
      return;
    }

    try {
      options.chatService.createMessage({
        thread_id: threadId,
        message: buildAssistantMessage(result.text),
        metadata: '{}',
      });
    } catch (error) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.message.persist',
        outcome: 'failed',
        error,
        entity: {
          thread_id: threadId,
          role: 'assistant',
        },
      });
    }

    if (event.message_type === 'private') {
      try {
        await sendAction(ws, 'send_private_msg', {
          user_id: event.user_id,
          message: result.text,
        });
      } catch (error) {
        napcatLogger.event({
          level: 'warn',
          event: 'napcat.reply.send',
          outcome: 'failed',
          error,
          data: {
            message_type: 'private',
          },
        });
      }
      return;
    }

    try {
      await sendAction(ws, 'send_group_msg', {
        group_id: event.group_id,
        message: result.text,
      });
    } catch (error) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.reply.send',
        outcome: 'failed',
        error,
        data: {
          message_type: 'group',
        },
      });
    }
  };

  const handleUpgrade = (req: http.IncomingMessage, socket: unknown, head: Buffer) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/onebot/v11/ws') return false;
    const remote = getRemoteLabel(req);

    const napcatConfig = getNapCatConfig();
    if (!napcatConfig.enabled) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.ws.upgrade',
        outcome: 'denied',
        message: `Upgrade rejected from ${remote}: bridge disabled.`,
        data: {
          remote,
        },
      });
      if (socket && typeof (socket as { write?: unknown }).write === 'function') {
        (socket as { write: (data: string) => void }).write('HTTP/1.1 404 Not Found\r\n\r\n');
      }
      if (socket && typeof (socket as { destroy?: unknown }).destroy === 'function') {
        (socket as { destroy: () => void }).destroy();
      }
      return true;
    }

    const token = parseToken(req);
    if (napcatConfig.accessToken && token !== napcatConfig.accessToken) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.ws.upgrade',
        outcome: 'denied',
        message: `Upgrade rejected from ${remote}: invalid access token.`,
        data: {
          remote,
        },
      });
      if (socket && typeof (socket as { write?: unknown }).write === 'function') {
        (socket as { write: (data: string) => void }).write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      }
      if (socket && typeof (socket as { destroy?: unknown }).destroy === 'function') {
        (socket as { destroy: () => void }).destroy();
      }
      return true;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      napcatLogger.event({
        level: 'info',
        event: 'napcat.ws.upgrade',
        outcome: 'succeeded',
        message: `Reverse WS upgraded from ${remote}.`,
        data: {
          remote,
        },
      });
      wss.emit('connection', ws, req);
    });
    return true;
  };

  wss.on('connection', (ws, req) => {
    const remote = getRemoteLabel(req);
    activeSockets.push(ws);
    napcatLogger.event({
      level: 'info',
      event: 'napcat.ws.connection',
      outcome: 'succeeded',
      message: `Reverse WS connected: ${remote}.`,
      data: {
        remote,
      },
    });

    ws.on('close', () => {
      removeActiveSocket(ws);
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.ws.connection',
        outcome: 'cancelled',
        message: `Reverse WS disconnected: ${remote}.`,
        data: {
          remote,
        },
      });
    });

    ws.on('error', error => {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.ws.connection',
        outcome: 'failed',
        error,
        message: 'Reverse WS socket error.',
        data: {
          remote,
        },
      });
    });

    ws.on('message', async (data: unknown) => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (!payload || typeof payload !== 'object') return;

      if (handleActionResponse(payload as NapCatActionResponse)) {
        return;
      }

      try {
        await handleIncomingMessage(payload as NapCatMessageEvent, ws);
      } catch (error) {
        napcatLogger.event({
          level: 'warn',
          event: 'napcat.message.handle',
          outcome: 'failed',
          error,
          message: 'Unhandled NapCat message processing error.',
        });
      }
    });
  });

  return {
    wss,
    handleUpgrade,
    sendThreadMessage,
    dispose: () => {
      unregisterBridgeThreadSender();
      activeSockets.splice(0, activeSockets.length);

      for (const pending of pendingActions.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('NapCat bridge disposed'));
      }
      pendingActions.clear();
    },
  };
};
