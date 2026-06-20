import type http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import type { ChatService } from '@iki/backend/chat_service';
import { parseStoredUiMessageRow } from '@iki/backend/chat/ui_message_codec';
import type { ChatTransportMessage } from '@iki/backend/chat_service';
import { getAppConfig } from '@iki/backend/config';
import { createDaemonLogger, recordNapCatMessagePreview } from '@iki/backend/daemon_logs';
import { getProviders } from '@iki/backend/db/providers';
import { createComposerInvocationPart, type ComposerInvocationPartData } from '@iki/backend/chat/message_parts';
import { parseSlashCommandDraft } from '@iki/backend/chat/slash_commands';
import type { ChatThread } from '@iki/backend/types/chat';
import type { NapCatBridgeHeartbeatInfo, NapCatBridgeStatusInfo } from '@iki/backend/types/config';
import { parseModelList } from '@iki/backend/utils/provider_models';
import { isObjectRecord } from '@iki/backend/utils/guards';
import { renderMarkdownToPlainText } from '@iki/backend/utils/plain_text_markdown';
import type { ParsedUiMessage } from '@iki/backend/chat/ui_message_codec';
import { registerBridgeThreadSender } from '@iki/backend/bridge_dispatch';
import { resolveNapCatInboundSlashCommand } from './napcat_slash_commands';

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

const nodeRequire = createRequire(fileURLToPath(import.meta.url));

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

type NapCatMetaEvent = {
  post_type?: string;
  meta_event_type?: string;
  sub_type?: string;
  status?: {
    online?: boolean;
    good?: boolean;
  };
  interval?: number;
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

type StoredUiTextMessage = {
  role: 'system' | 'user' | 'assistant';
  parts: Array<
    | { type: 'text'; text: string }
    | ReturnType<typeof createComposerInvocationPart>
  >;
};

type PendingAction = {
  action: string;
  resolve: (value: NapCatActionResponse) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

type NapCatHeartbeatSnapshot = {
  receivedAt: string;
  receivedAtMs: number;
  intervalMs: number | null;
  online: boolean | null;
  good: boolean | null;
};

const SAFE_NAPCAT_TOOLS = ['web', 'fetch'] as const;
const SAFE_NAPCAT_TOOL_SET = new Set<string>(SAFE_NAPCAT_TOOLS);
// Use NapCat's own advertised heartbeat interval, with one grace interval, to avoid
// hard-coding transport timing assumptions into desktop settings.
const HEARTBEAT_STALE_MULTIPLIER = 2;

const DEFAULT_SYSTEM_PROMPT = [
  'You are iKi, responding to QQ messages via NapCat.',
  'Keep replies concise and helpful.',
  'Output plain text only for QQ. Do not use markdown, headings, tables, or code fences.',
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

const normalizeHeartbeatIntervalMs = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
};

const buildEmptyHeartbeatInfo = (): NapCatBridgeHeartbeatInfo => ({
  lastReceivedAt: null,
  intervalMs: null,
  ageMs: null,
  online: null,
  good: null,
  stale: null,
});

const isHeartbeatSnapshotFresh = (
  snapshot: NapCatHeartbeatSnapshot,
  nowMs: number
): boolean | null => {
  if (snapshot.intervalMs === null) return null;
  return nowMs - snapshot.receivedAtMs <= snapshot.intervalMs * HEARTBEAT_STALE_MULTIPLIER;
};

const isHeartbeatSnapshotHealthy = (
  snapshot: NapCatHeartbeatSnapshot,
  nowMs: number
): boolean => {
  const fresh = isHeartbeatSnapshotFresh(snapshot, nowMs);
  const online = snapshot.online !== false;
  const good = snapshot.good !== false;
  return fresh !== false && online && good;
};

const buildHeartbeatInfo = (
  snapshot: NapCatHeartbeatSnapshot | null,
  nowMs: number
): NapCatBridgeHeartbeatInfo => {
  if (!snapshot) {
    return buildEmptyHeartbeatInfo();
  }

  const fresh = isHeartbeatSnapshotFresh(snapshot, nowMs);

  return {
    lastReceivedAt: snapshot.receivedAt,
    intervalMs: snapshot.intervalMs,
    ageMs: Math.max(0, nowMs - snapshot.receivedAtMs),
    online: snapshot.online,
    good: snapshot.good,
    stale: fresh === null ? null : !fresh,
  };
};

const decodeCqText = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#44;/g, ',');

const parseCqParams = (rawParams: string): Record<string, string> => {
  const params = rawParams.startsWith(',') ? rawParams.slice(1) : rawParams;
  if (!params) return {};

  const parsed: Record<string, string> = {};
  for (const entry of params.split(',')) {
    if (!entry) continue;
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = entry.slice(0, separatorIndex).trim();
    const value = decodeCqText(entry.slice(separatorIndex + 1));
    if (!key) continue;
    parsed[key] = value;
  }

  return parsed;
};

const parseStringMessageText = (
  value: string,
  selfId: string
): { text: string; mentionedSelf: boolean } => {
  const text = value.trim();
  if (!text) return { text: '', mentionedSelf: false };
  if (!text.includes('[CQ:')) {
    return { text, mentionedSelf: text.includes(`@${selfId}`) };
  }

  let normalized = '';
  let mentionedSelf = false;
  let lastIndex = 0;
  const segmentPattern = /\[CQ:([a-zA-Z0-9_-]+)((?:,[^\]]*)?)\]/g;

  for (const match of text.matchAll(segmentPattern)) {
    const [rawSegment, type, rawParams = ''] = match;
    const start = match.index ?? 0;
    normalized += decodeCqText(text.slice(lastIndex, start));

    const params = parseCqParams(rawParams);
    if (type === 'at') {
      const qq = params.qq || params.id || '';
      normalized += qq === 'all' ? '@all ' : qq ? `@${qq} ` : '';
      if (normalizeId(qq) === selfId) {
        mentionedSelf = true;
      }
    } else if (type === 'image') {
      normalized += '[image]';
    }

    lastIndex = start + rawSegment.length;
  }

  normalized += decodeCqText(text.slice(lastIndex));
  const trimmed = normalized.trim().replace(/ {2,}/g, ' ');
  return { text: trimmed, mentionedSelf };
};

const parseMessageText = (
  message: NapCatMessageEvent['message'],
  rawMessage: string | undefined,
  selfId: string
): { text: string; mentionedSelf: boolean } => {
  if (typeof message === 'string') {
    return parseStringMessageText(message, selfId);
  }

  if (!Array.isArray(message)) {
    const fallback = typeof rawMessage === 'string' ? rawMessage : '';
    return parseStringMessageText(fallback, selfId);
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
    return parseStringMessageText(rawMessage, selfId);
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

const filterNapCatTools = (tools: string[]): string[] => {
  const filtered: string[] = [];
  const seen = new Set<string>();

  for (const toolName of tools) {
    const normalized = toolName.trim();
    if (!normalized || seen.has(normalized)) continue;
    if (!SAFE_NAPCAT_TOOL_SET.has(normalized)) continue;
    seen.add(normalized);
    filtered.push(normalized);
  }

  return filtered;
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

const buildSystemMessage = (event: NapCatMessageEvent): ChatTransportMessage => {
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
    content: lines.join('\n'),
  };
};

const buildUserMessage = (text: string): StoredUiTextMessage => ({
  role: 'user',
  parts: [{ type: 'text', text }],
});

const buildUserMessageWithComposerInvocations = (
  text: string,
  composerInvocations?: ComposerInvocationPartData
): StoredUiTextMessage => {
  const tokens = composerInvocations?.tokens?.filter(
    token =>
      token &&
      typeof token.id === 'string' &&
      typeof token.label === 'string' &&
      token.label.trim().length > 0
  );

  return {
    role: 'user',
    parts: [
      ...(tokens && tokens.length > 0
        ? [createComposerInvocationPart({ tokens })]
        : []),
      { type: 'text', text },
    ],
  };
};

const buildAssistantMessage = (text: string): StoredUiTextMessage => ({
  role: 'assistant',
  parts: [{ type: 'text', text }],
});

const formatNapCatOutboundText = (text: string): string => {
  const normalized = renderMarkdownToPlainText(text).trim();
  return normalized || text.trim();
};

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

const buildNapCatThreadMetadata = (event: NapCatMessageEvent): string =>
  JSON.stringify({
    source: 'napcat',
    message_type: event.message_type,
    self_id: event.self_id,
    group_id: event.group_id,
    user_id: event.user_id,
  });

const buildNapCatThreadSeed = (params: {
  event: NapCatMessageEvent;
  threadId: string;
  clientId: string;
  existingThread?: ChatThread | null;
  isIncognito?: boolean;
}): {
  id: string;
  title: string;
  metadata: string;
  client_id: string;
  is_incognito: number;
  workspace_id?: string;
} => {
  const existingThread = params.existingThread;
  const existingWorkspaceId =
    typeof existingThread?.workspace_id === 'string' && existingThread.workspace_id.trim()
      ? existingThread.workspace_id
      : undefined;

  return {
    id: params.threadId,
    title:
      typeof existingThread?.title === 'string' && existingThread.title.trim()
        ? existingThread.title
        : buildThreadTitle(params.event),
    metadata: buildNapCatThreadMetadata(params.event),
    client_id: params.clientId,
    is_incognito:
      typeof params.isIncognito === 'boolean'
        ? params.isIncognito
          ? 1
          : 0
        : existingThread?.is_incognito
          ? 1
          : 0,
    workspace_id: existingWorkspaceId,
  };
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
  const heartbeatSnapshots = new Map<ReverseBridgeSocket, NapCatHeartbeatSnapshot>();
  let lastConnectedAt: string | null = null;
  let lastDisconnectedAt: string | null = null;
  let nextEcho = 1;

  const countReadySockets = (): number =>
    activeSockets.filter(socket => socket?.readyState === 1).length;

  const getStatus = (): NapCatBridgeStatusInfo => {
    const napcatConfig = getNapCatConfig();
    const activeConnectionCount = countReadySockets();
    const readySockets = activeSockets.filter(socket => socket?.readyState === 1);
    const nowMs = Date.now();
    const activeHeartbeats = readySockets
      .map(socket => heartbeatSnapshots.get(socket) || null)
      .filter((snapshot): snapshot is NapCatHeartbeatSnapshot => Boolean(snapshot));
    const latestHealthyHeartbeat = activeHeartbeats
      .filter(snapshot => isHeartbeatSnapshotHealthy(snapshot, nowMs))
      .sort((left, right) => right.receivedAtMs - left.receivedAtMs)[0];
    const latestHeartbeat =
      latestHealthyHeartbeat ||
      activeHeartbeats.sort((left, right) => right.receivedAtMs - left.receivedAtMs)[0] ||
      null;
    const heartbeat = buildHeartbeatInfo(latestHeartbeat, nowMs);

    if (!napcatConfig.enabled) {
      return {
        state: 'disabled',
        activeConnectionCount,
        lastConnectedAt,
        lastDisconnectedAt,
        heartbeat,
      };
    }

    return {
      state: activeConnectionCount === 0 ? 'disconnected' : 'connected',
      activeConnectionCount,
      lastConnectedAt,
      lastDisconnectedAt,
      heartbeat,
    };
  };

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

  const sendBridgeReply = async (
    ws: ReverseBridgeSocket,
    event: Pick<NapCatMessageEvent, 'message_type' | 'user_id' | 'group_id'>,
    text: string
  ) => {
    if (event.message_type === 'private') {
      await sendAction(ws, 'send_private_msg', {
        user_id: event.user_id,
        message: text,
      });
      return;
    }

    await sendAction(ws, 'send_group_msg', {
      group_id: event.group_id,
      message: text,
    });
  };

  const getActiveSocket = (): ReverseBridgeSocket | null => {
    for (let index = activeSockets.length - 1; index >= 0; index -= 1) {
      const socket = activeSockets[index];
      if (socket?.readyState === 1) return socket;
    }
    return null;
  };

  const removeActiveSocket = (ws: ReverseBridgeSocket) => {
    const hadTrackedConnections = activeSockets.length > 0;
    const index = activeSockets.indexOf(ws);
    if (index >= 0) {
      activeSockets.splice(index, 1);
    }
    heartbeatSnapshots.delete(ws);
    if (hadTrackedConnections && activeSockets.length === 0) {
      lastDisconnectedAt = new Date().toISOString();
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

    const message = formatNapCatOutboundText(params.text);
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

  const handleMetaEvent = (payload: NapCatMetaEvent, ws: ReverseBridgeSocket) => {
    if (payload.post_type !== 'meta_event') return false;

    if (payload.meta_event_type === 'heartbeat') {
      const receivedAtMs = Date.now();
      heartbeatSnapshots.set(ws, {
        receivedAt: new Date(receivedAtMs).toISOString(),
        receivedAtMs,
        intervalMs: normalizeHeartbeatIntervalMs(payload.interval),
        online: typeof payload.status?.online === 'boolean' ? payload.status.online : null,
        good: typeof payload.status?.good === 'boolean' ? payload.status.good : null,
      });
    }

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
    const napcatTools = filterNapCatTools(napcatConfig.tools);
    const modelConfig = resolveNapCatModel(napcatConfig);

    const { text, mentionedSelf } = parseMessageText(event.message, event.raw_message, selfId);
    if (!text) return;
    const replyEligible =
      !napcatConfig.requireMention || event.message_type !== 'group' || mentionedSelf;

    recordNapCatMessagePreview({
      receivedAt: new Date().toISOString(),
      messageType: event.message_type,
      userId: userId || 'unknown',
      ...(event.group_id !== undefined ? { groupId: normalizeId(event.group_id) } : {}),
      ...(event.self_id !== undefined ? { selfId: selfId } : {}),
      ...(event.message_id !== undefined ? { messageId: normalizeId(event.message_id) } : {}),
      textPreview: text,
      mentionedSelf,
      replyEligible,
    });

    if (!replyEligible) return;

    const threadId = buildThreadId(event);
    const existingThread = options.chatService.getThread(threadId);
    const slashResolution = parseSlashCommandDraft(text)
      ? await resolveNapCatInboundSlashCommand({
          draft: text,
          locale: getAppConfig().general?.language,
          currentIncognito: Boolean(existingThread?.is_incognito),
          bridgeReady: Boolean(modelConfig),
        })
      : {
          kind: 'message' as const,
          content: text,
        };

    if (slashResolution.kind === 'feedback') {
      if (typeof slashResolution.nextIncognito === 'boolean') {
        try {
          if (existingThread) {
            options.chatService.updateThread(threadId, {
              is_incognito: slashResolution.nextIncognito ? 1 : 0,
            });
          } else {
            options.chatService.createThread(
              buildNapCatThreadSeed({
                event,
                threadId,
                clientId: options.clientId,
                existingThread,
                isIncognito: slashResolution.nextIncognito,
              })
            );
          }
        } catch (error) {
          napcatLogger.event({
            level: 'warn',
            event: 'napcat.thread.update',
            outcome: 'failed',
            error,
            entity: {
              thread_id: threadId,
            },
            data: {
              is_incognito: slashResolution.nextIncognito,
            },
          });
        }
      }

      const feedbackText = formatNapCatOutboundText(slashResolution.feedback);
      try {
        await sendBridgeReply(ws, event, feedbackText);
      } catch (error) {
        napcatLogger.event({
          level: 'warn',
          event: 'napcat.reply.send',
          outcome: 'failed',
          error,
          data: {
            message_type: event.message_type,
            slash_feedback: true,
          },
        });
      }
      return;
    }

    if (slashResolution.kind === 'reset-thread') {
      try {
        if (existingThread) {
          options.chatService.clearThread(
            threadId,
            buildNapCatThreadSeed({
              event,
              threadId,
              clientId: options.clientId,
              existingThread,
            })
          );
        } else {
          options.chatService.createThread(
            buildNapCatThreadSeed({
              event,
              threadId,
              clientId: options.clientId,
              existingThread,
            })
          );
        }
      } catch (error) {
        napcatLogger.event({
          level: 'warn',
          event: 'napcat.thread.reset',
          outcome: 'failed',
          error,
          entity: {
            thread_id: threadId,
          },
        });
      }

      const feedbackText = formatNapCatOutboundText(slashResolution.feedback);
      try {
        await sendBridgeReply(ws, event, feedbackText);
      } catch (error) {
        napcatLogger.event({
          level: 'warn',
          event: 'napcat.reply.send',
          outcome: 'failed',
          error,
          data: {
            message_type: event.message_type,
            slash_feedback: true,
            slash_reset_thread: true,
          },
        });
      }
      return;
    }

    if (!existingThread) {
      options.chatService.createThread(
        buildNapCatThreadSeed({
          event,
          threadId,
          clientId: options.clientId,
        })
      );
    }

    const storedUserMessage =
      slashResolution.promptAppId || slashResolution.skillIds?.length
        ? buildUserMessageWithComposerInvocations(
            slashResolution.content,
            slashResolution.composerInvocations
          )
        : buildUserMessage(slashResolution.content);

    try {
      options.chatService.createMessage({
        thread_id: threadId,
        message: storedUserMessage,
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

    if (!modelConfig) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.message.handle',
        outcome: 'skipped',
        message: 'No provider/model configured; ignoring inbound message.',
      });
      return;
    }

    const rows = options.chatService.listMessages(threadId);
    const uiMessages = rows.map(row =>
      parseStoredUiMessageRow({ id: row.id, message: row.message })
    );
    const messages: Array<ChatTransportMessage | ParsedUiMessage> = [
      buildSystemMessage(event),
      ...uiMessages,
    ];

    const result = await options.chatService.send({
      providerType: modelConfig.providerType,
      model: modelConfig.model,
      messages,
      tools: napcatTools,
      ...(slashResolution.skillMode ? { skillMode: slashResolution.skillMode } : {}),
      ...(slashResolution.skillIds?.length ? { skillIds: slashResolution.skillIds } : {}),
      threadId,
    });

    if (result.success === false) {
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

    if (!result.text) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.reply.generate',
        outcome: 'failed',
        message: 'Generated reply was empty.',
        entity: {
          thread_id: threadId,
        },
      });
      return;
    }

    const outboundText = formatNapCatOutboundText(result.text);
    if (!outboundText) {
      napcatLogger.event({
        level: 'warn',
        event: 'napcat.reply.generate',
        outcome: 'failed',
        message: 'Generated NapCat reply became empty after QQ text normalization.',
        entity: {
          thread_id: threadId,
        },
      });
      return;
    }

    try {
      options.chatService.createMessage({
        thread_id: threadId,
        message: buildAssistantMessage(outboundText),
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

    try {
      await sendBridgeReply(ws, event, outboundText);
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
    const hadTrackedConnections = activeSockets.length > 0;
    activeSockets.push(ws);
    if (!hadTrackedConnections) {
      lastConnectedAt = new Date().toISOString();
    }
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
        napcatLogger.event({
          level: 'warn',
          event: 'napcat.ws.message',
          outcome: 'failed',
          message: 'Received malformed JSON from NapCat WebSocket.',
          data: {
            raw: String(data).slice(0, 200),
          },
        });
        return;
      }

      if (!payload || typeof payload !== 'object') return;

      if (handleActionResponse(payload as NapCatActionResponse)) {
        return;
      }

      if (handleMetaEvent(payload as NapCatMetaEvent, ws)) {
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
    getStatus,
    sendThreadMessage,
    dispose: () => {
      unregisterBridgeThreadSender();
      activeSockets.splice(0, activeSockets.length);
      heartbeatSnapshots.clear();

      for (const pending of pendingActions.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('NapCat bridge disposed'));
      }
      pendingActions.clear();
    },
  };
};
