import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ChatService } from '../main/services/chat/chat_service';
import { parseStoredUiMessageRow } from '../main/services/chat/chat_ui';
import { getProviders } from '../core/db/providers';
import { parseModelList } from '../shared/utils/provider_models';
import { isObjectRecord } from '../shared/utils/guards';

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
  accessToken?: string;
};

type PendingAction = {
  resolve: (value: NapCatActionResponse) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

const DEFAULT_SYSTEM_PROMPT = [
  'You are iKi, responding to QQ messages via NapCat.',
  'Keep replies concise and helpful.',
].join(' ');

const parseToken = (req: http.IncomingMessage): string | null => {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();

  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const tokenParam = url.searchParams.get('access_token') || url.searchParams.get('token');
  return tokenParam ? tokenParam.trim() : null;
};

const normalizeId = (value: number | string | undefined): string => {
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

const resolveNapCatModel = (): { providerType: string; model: string } | null => {
  const providerOverride = process.env.IKI_NAPCAT_PROVIDER?.trim();
  const modelOverride = process.env.IKI_NAPCAT_MODEL?.trim();

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

const parseToolList = (): string[] => {
  const raw = process.env.IKI_NAPCAT_TOOLS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
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

export const createNapCatReverseBridge = (options: NapCatBridgeOptions) => {
  const wss = new WebSocketServer({ noServer: true });
  const pendingActions = new Map<string, PendingAction>();
  let nextEcho = 1;

  const accessToken = options.accessToken?.trim() || '';
  const tools = parseToolList();
  const requireMention =
    String(process.env.IKI_NAPCAT_REQUIRE_MENTION || '').toLowerCase() === 'true';

  const sendAction = (ws: WebSocket, action: string, params: Record<string, unknown>) =>
    new Promise<NapCatActionResponse>((resolve, reject) => {
      const echo = `napcat_${Date.now()}_${nextEcho++}`;
      const timeout = setTimeout(() => {
        pendingActions.delete(echo);
        reject(new Error('NapCat action timeout'));
      }, 10000);

      pendingActions.set(echo, { resolve, reject, timeout });
      ws.send(JSON.stringify({ action, params, echo }));
    });

  const handleActionResponse = (payload: NapCatActionResponse) => {
    if (!payload.echo) return false;
    const echo = String(payload.echo);
    const pending = pendingActions.get(echo);
    if (!pending) return true;
    clearTimeout(pending.timeout);
    pendingActions.delete(echo);
    pending.resolve(payload);
    return true;
  };

  const handleIncomingMessage = async (event: NapCatMessageEvent, ws: WebSocket) => {
    if (event.post_type !== 'message') return;
    if (event.message_type !== 'private' && event.message_type !== 'group') return;

    const selfId = normalizeId(event.self_id);
    const userId = normalizeId(event.user_id);
    if (selfId && userId && selfId === userId) return;

    const { text, mentionedSelf } = parseMessageText(event.message, event.raw_message, selfId);
    if (!text) return;
    if (requireMention && event.message_type === 'group' && !mentionedSelf) return;

    const modelConfig = resolveNapCatModel();
    if (!modelConfig) {
      console.warn('[NapCat] No provider/model configured, ignoring message');
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
      console.warn('[NapCat] Failed to persist user message:', error);
    }

    const rows = options.chatService.listMessages(threadId);
    const uiMessages = rows.map(row => parseStoredUiMessageRow({ id: row.id, message: row.message }));
    const messages = [buildSystemMessage(event), ...uiMessages];

    const result = await options.chatService.send({
      providerType: modelConfig.providerType,
      model: modelConfig.model,
      messages,
      tools,
      threadId,
    });

    if (!result.success || !result.text) {
      console.warn('[NapCat] LLM failed:', result.error);
      return;
    }

    try {
      options.chatService.createMessage({
        thread_id: threadId,
        message: buildAssistantMessage(result.text),
        metadata: '{}',
      });
    } catch (error) {
      console.warn('[NapCat] Failed to persist assistant message:', error);
    }

    if (event.message_type === 'private') {
      try {
        await sendAction(ws, 'send_private_msg', {
          user_id: event.user_id,
          message: result.text,
        });
      } catch (error) {
        console.warn('[NapCat] Failed to send private reply:', error);
      }
      return;
    }

    try {
      await sendAction(ws, 'send_group_msg', {
        group_id: event.group_id,
        message: result.text,
      });
    } catch (error) {
      console.warn('[NapCat] Failed to send group reply:', error);
    }
  };

  const handleUpgrade = (req: http.IncomingMessage, socket: unknown, head: Buffer) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/onebot/v11/ws') return false;

    const token = parseToken(req);
    if (accessToken && token !== accessToken) {
      if (socket && typeof (socket as { write?: unknown }).write === 'function') {
        (socket as { write: (data: string) => void }).write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      }
      if (socket && typeof (socket as { destroy?: unknown }).destroy === 'function') {
        (socket as { destroy: () => void }).destroy();
      }
      return true;
    }

    wss.handleUpgrade(req, socket as never, head, ws => {
      wss.emit('connection', ws, req);
    });
    return true;
  };

  wss.on('connection', ws => {
    ws.on('message', async data => {
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(data.toString()) as Record<string, unknown>;
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
        console.warn('[NapCat] Handler error:', error);
      }
    });
  });

  return { wss, handleUpgrade };
};
