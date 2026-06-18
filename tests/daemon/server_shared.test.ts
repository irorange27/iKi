import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockClient = {
  id: string;
  name: string;
  scopes: string[];
  allowedTools: string[];
};

const {
  createAppClientMock,
  getAppClientByIdMock,
  getAppClientByTokenMock,
  listAppClientsMock,
  touchAppClientMock,
  getChatThreadMock,
  resetState,
  seedClient,
} = vi.hoisted(() => {
  const clientsById = new Map<string, MockClient>();
  const tokenToClientId = new Map<string, string>();

  const createClient = (input: {
    id: string;
    token: string;
    name?: string;
    scopes?: string[];
    allowedTools?: string[];
  }) => {
    const client: MockClient = {
      id: input.id,
      name: input.name ?? input.id,
      scopes: [...(input.scopes ?? [])],
      allowedTools: [...(input.allowedTools ?? [])],
    };
    clientsById.set(client.id, client);
    tokenToClientId.set(input.token, client.id);
    return client;
  };

  const resetState = () => {
    clientsById.clear();
    tokenToClientId.clear();
    vi.clearAllMocks();
  };

  const seedClient = (input: {
    id: string;
    token: string;
    name?: string;
    scopes?: string[];
    allowedTools?: string[];
  }) => createClient(input);

  const createAppClientMock = vi.fn((input: Record<string, unknown>) => ({
    client: createClient({
      id: String(input.id ?? 'client_napcat'),
      token: `token_${String(input.id ?? 'client_napcat')}`,
      name: typeof input.name === 'string' ? input.name : undefined,
      scopes: Array.isArray(input.scopes) ? (input.scopes as string[]) : [],
      allowedTools: Array.isArray(input.allowedTools) ? (input.allowedTools as string[]) : [],
    }),
    token: `token_${String(input.id ?? 'client_napcat')}`,
  }));

  const getAppClientByIdMock = vi.fn((id: string) => clientsById.get(id) ?? null);
  const getAppClientByTokenMock = vi.fn((token: string) => {
    const clientId = tokenToClientId.get(token);
    return clientId ? (clientsById.get(clientId) ?? null) : null;
  });
  const listAppClientsMock = vi.fn(() => Array.from(clientsById.values()));
  const touchAppClientMock = vi.fn();
  const getChatThreadMock = vi.fn();

  return {
    createAppClientMock,
    getAppClientByIdMock,
    getAppClientByTokenMock,
    listAppClientsMock,
    touchAppClientMock,
    getChatThreadMock,
    resetState,
    seedClient,
  };
});

vi.mock('@iki/core/db/app_clients', () => ({
  createAppClient: createAppClientMock,
  getAppClientById: getAppClientByIdMock,
  getAppClientByToken: getAppClientByTokenMock,
  listAppClients: listAppClientsMock,
  touchAppClient: touchAppClientMock,
}));

vi.mock('@iki/core/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
}));

import {
  authenticateRequest,
  authenticateWebSocket,
  ensureNapCatClient,
  getThreadOrError,
  hasScope,
  isFirstUserClientRegistration,
  parseJsonBody,
} from '@iki/daemon/server_shared';

const createBodyRequest = () => {
  const req = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  req.destroy = vi.fn();
  return req;
};

describe('server_shared', () => {
  beforeEach(() => {
    resetState();
  });

  it('creates the NapCat client when it is missing', () => {
    expect(ensureNapCatClient()).toBe('client_napcat');
    expect(createAppClientMock).toHaveBeenCalledWith({
      id: 'client_napcat',
      name: 'NapCat',
      scopes: [],
      allowedTools: [],
    });
  });

  it('reuses the existing NapCat client when present', () => {
    seedClient({ id: 'client_napcat', token: 'token_napcat', name: 'NapCat' });

    expect(ensureNapCatClient()).toBe('client_napcat');
    expect(createAppClientMock).not.toHaveBeenCalled();
  });

  it('treats setup as first-user registration only when no non-system clients exist', () => {
    seedClient({ id: 'client_napcat', token: 'token_napcat' });
    expect(isFirstUserClientRegistration('client_napcat')).toBe(true);

    seedClient({ id: 'client_user', token: 'token_user' });
    expect(isFirstUserClientRegistration('client_napcat')).toBe(false);
  });

  it('parses JSON request bodies and empty bodies', async () => {
    const jsonReq = createBodyRequest();
    const jsonBody = parseJsonBody(jsonReq as never);
    jsonReq.emit('data', Buffer.from('{"name":"iki"}'));
    jsonReq.emit('end');
    await expect(jsonBody).resolves.toEqual({ name: 'iki' });

    const emptyReq = createBodyRequest();
    const emptyBody = parseJsonBody(emptyReq as never);
    emptyReq.emit('end');
    await expect(emptyBody).resolves.toEqual({});
  });

  it('rejects invalid JSON request bodies', async () => {
    const req = createBodyRequest();
    const body = parseJsonBody(req as never);
    req.emit('data', Buffer.from('{invalid'));
    req.emit('end');

    await expect(body).rejects.toBeInstanceOf(SyntaxError);
  });

  it('rejects oversized request bodies and destroys the request', async () => {
    const req = createBodyRequest();
    const body = parseJsonBody(req as never);
    req.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));

    await expect(body).rejects.toThrow('Request body too large');
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects bodies that exceed the limit across multiple chunks (pre-check boundary)', async () => {
    const req = createBodyRequest();
    const body = parseJsonBody(req as never);

    // Fill exactly to the limit
    req.emit('data', Buffer.alloc(2 * 1024 * 1024));
    // One more byte should trigger rejection
    req.emit('data', Buffer.alloc(1));

    await expect(body).rejects.toThrow('Request body too large');
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores subsequent data and end events after the body has been rejected', async () => {
    const req = createBodyRequest();
    const body = parseJsonBody(req as never);

    // Send an oversized chunk to trigger rejection + destroy
    req.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
    // These should be no-ops — the promise is already settled
    req.emit('data', Buffer.from('more data'));
    req.emit('end');

    await expect(body).rejects.toThrow('Request body too large');
    // destroy should only be called once
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores data events that arrive after an error event settled the promise', async () => {
    const req = createBodyRequest();
    const body = parseJsonBody(req as never);

    req.emit('error', new Error('connection reset'));
    // These should be no-ops
    req.emit('data', Buffer.from('late data'));
    req.emit('end');

    await expect(body).rejects.toThrow('connection reset');
  });

  it('authenticates HTTP requests with bearer or fallback token headers', () => {
    seedClient({
      id: 'client_http',
      token: 'token_http',
      name: 'HTTP Client',
      scopes: ['chat:read'],
      allowedTools: ['fetch'],
    });

    expect(
      authenticateRequest({
        headers: {
          authorization: 'Bearer token_http',
          'x-iki-client': 'client_http',
        },
      } as never)
    ).toEqual({
      client: {
        id: 'client_http',
        name: 'HTTP Client',
        scopes: ['chat:read'],
        allowedTools: ['fetch'],
      },
    });

    expect(
      authenticateRequest({
        headers: {
          'x-iki-token': 'token_http',
          'x-iki-client': 'client_http',
        },
      } as never).client?.id
    ).toBe('client_http');
    expect(touchAppClientMock).toHaveBeenCalledWith('client_http');
  });

  it('rejects invalid HTTP auth combinations', () => {
    expect(authenticateRequest({ headers: {} } as never)).toEqual({
      error: 'Missing Authorization token',
    });

    expect(
      authenticateRequest({
        headers: { authorization: 'Bearer token_http' },
      } as never)
    ).toEqual({
      error: 'Missing X-Iki-Client header',
    });

    seedClient({ id: 'client_http', token: 'token_http' });
    expect(
      authenticateRequest({
        headers: {
          authorization: 'Bearer wrong',
          'x-iki-client': 'client_http',
        },
      } as never)
    ).toEqual({
      error: 'Invalid token',
    });

    expect(
      authenticateRequest({
        headers: {
          authorization: 'Bearer token_http',
          'x-iki-client': 'other_client',
        },
      } as never)
    ).toEqual({
      error: 'Client id does not match token',
    });
  });

  it('authenticates WebSocket connections from query parameters', () => {
    seedClient({
      id: 'client_ws',
      token: 'token_ws',
      name: 'WS Client',
      scopes: ['chat:write'],
      allowedTools: ['shell'],
    });

    expect(
      authenticateWebSocket({
        url: '/v1/chat/stream?token=token_ws&client_id=client_ws',
        headers: {},
      } as never)
    ).toEqual({
      client: {
        id: 'client_ws',
        name: 'WS Client',
        scopes: ['chat:write'],
        allowedTools: ['shell'],
      },
    });
    expect(touchAppClientMock).toHaveBeenCalledWith('client_ws');
  });

  it('rejects WebSocket auth without a matching client id', () => {
    seedClient({ id: 'client_ws', token: 'token_ws' });

    expect(
      authenticateWebSocket({
        url: '/v1/chat/stream?token=token_ws',
        headers: {},
      } as never)
    ).toEqual({
      error: 'Missing client_id',
    });

    expect(
      authenticateWebSocket({
        url: '/v1/chat/stream?token=token_ws&client_id=other_client',
        headers: {},
      } as never)
    ).toEqual({
      error: 'Client id does not match token',
    });
  });

  it('checks scopes and thread ownership', () => {
    expect(hasScope({ id: 'c', name: 'n', scopes: ['chat:read'], allowedTools: [] }, 'chat:read')).toBe(
      true
    );
    expect(hasScope({ id: 'c', name: 'n', scopes: [], allowedTools: [] }, 'chat:read')).toBe(
      false
    );

    getChatThreadMock.mockReturnValueOnce(null);
    expect(getThreadOrError('thread_missing', 'client_a')).toEqual({
      status: 404,
      error: 'Thread not found',
    });

    getChatThreadMock.mockReturnValueOnce({ id: 'thread_denied', client_id: 'client_b' });
    expect(getThreadOrError('thread_denied', 'client_a')).toEqual({
      status: 403,
      error: 'Thread access denied',
    });

    const thread = { id: 'thread_ok', client_id: 'client_a' };
    getChatThreadMock.mockReturnValueOnce(thread);
    expect(getThreadOrError('thread_ok', 'client_a')).toEqual({ thread });
  });
});
