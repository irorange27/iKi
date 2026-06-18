import http from 'node:http';

import * as chatThreadDb from '@iki/core/db/chat_thread';
import {
  createAppClient,
  getAppClientById,
  getAppClientByToken,
  listAppClients,
  touchAppClient,
  type AppClient,
} from '@iki/core/db/app_clients';

export type DaemonSocket = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type DaemonSocketServer = {
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
  close: (callback?: (err?: Error) => void) => void;
};

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type DaemonClient = {
  id: string;
  name: string;
  scopes: string[];
  allowedTools: string[];
};

export type WsSession = {
  id: number;
  ws: DaemonSocket;
  client: DaemonClient;
  webContents: { id: number; send: (channel: string, ...args: unknown[]) => void };
};

const MAX_BODY_BYTES = 1024 * 1024 * 2;

export const ensureNapCatClient = (): string => {
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

export const isFirstUserClientRegistration = (systemClientId: string): boolean =>
  !listAppClients().some(client => client.id !== systemClientId);

export const parseJsonBody = (req: http.IncomingMessage): Promise<JsonValue> =>
  new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;

    req.on('data', chunk => {
      if (settled) return;
      if (bytes + chunk.length > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      bytes += chunk.length;
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
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

    req.on('error', err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });

export const writeJson = (res: http.ServerResponse, status: number, payload: JsonValue) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const withCors = (res: http.ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Iki-Client, X-Iki-Setup-Token, X-Iki-Connection'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

export const toDaemonClient = (client: AppClient): DaemonClient => ({
  id: client.id,
  name: client.name,
  scopes: client.scopes,
  allowedTools: client.allowedTools,
});

export const hasScope = (client: DaemonClient, scope: string): boolean =>
  client.scopes.includes(scope);

const extractBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
};

export const authenticateRequest = (
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

export const authenticateWebSocket = (
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

export const getThreadOrError = (threadId: string, clientId: string) => {
  const thread = chatThreadDb.getChatThread(threadId);
  if (!thread) {
    return { status: 404, error: 'Thread not found' };
  }
  if (thread.client_id && thread.client_id !== clientId) {
    return { status: 403, error: 'Thread access denied' };
  }
  return { thread };
};
