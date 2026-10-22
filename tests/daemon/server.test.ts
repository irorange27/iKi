import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

type MockAppClient = {
  id: string;
  name: string;
  tokenHash: string;
  scopes: string[];
  allowedTools: string[];
  created_at: string;
  updated_at: string;
  last_seen: string | null;
};

const {
  resetAppClientState,
  resetBootstrapState,
  createAppClientMock,
  getAppConfigMock,
  getAppClientByIdMock,
  getAppClientByTokenMock,
  listAppClientsMock,
  touchAppClientMock,
  registerStandardToolsMock,
  initializeDatabaseMock,
  getUserDataPathMock,
  setPlatformInfoMock,
  createChatServiceMock,
  chatServiceMock,
  getChatThreadMock,
  getDefaultAllowedToolsMock,
  readOrCreateBootstrapTokenMock,
  rotateBootstrapTokenMock,
  getMcpManagerMock,
  mcpManagerMock,
  readRequestedMcpServerIdsMock,
  resolveMcpServerIdsForClientMock,
  resolveToolsForClientMock,
  mkdirSyncMock,
  writeFileSyncMock,
  daemonLoggerEventMock,
  applyAppLoggingConfigMock,
  createServerMock,
  getRequestHandler,
  resetHttpHarness,
  serverMock,
} = vi.hoisted(() => {
  const clientsById = new Map<string, MockAppClient>();
  const tokenToClientId = new Map<string, string>();
  let nextClientId = 1;
  let bootstrapRotation = 0;

  const nowIso = '2026-03-21T00:00:00.000Z';
  const currentBootstrapToken = () =>
    bootstrapRotation === 0 ? 'setup-token' : `setup-token-rotated-${bootstrapRotation}`;

  const resetAppClientState = () => {
    clientsById.clear();
    tokenToClientId.clear();
    nextClientId = 1;
  };

  const resetBootstrapState = () => {
    bootstrapRotation = 0;
  };

  const createAppClientMock = vi.fn((input: Record<string, unknown>) => {
    const id =
      typeof input.id === 'string' && input.id.trim()
        ? input.id.trim()
        : `client_${nextClientId++}`;
    const token = `token_${id}`;
    const client: MockAppClient = {
      id,
      name: typeof input.name === 'string' ? input.name : 'iKi Client',
      tokenHash: `hash_${id}`,
      scopes: Array.isArray(input.scopes) ? [...(input.scopes as string[])] : [],
      allowedTools: Array.isArray(input.allowedTools) ? [...(input.allowedTools as string[])] : [],
      created_at: nowIso,
      updated_at: nowIso,
      last_seen: nowIso,
    };
    clientsById.set(id, client);
    tokenToClientId.set(token, id);
    return { client, token };
  });

  const getAppClientByIdMock = vi.fn((id: string) => clientsById.get(id) ?? null);
  const getAppClientByTokenMock = vi.fn((token: string) => {
    const clientId = tokenToClientId.get(token);
    return clientId ? (clientsById.get(clientId) ?? null) : null;
  });
  const listAppClientsMock = vi.fn(() => Array.from(clientsById.values()));
  const touchAppClientMock = vi.fn((id: string) => {
    const client = clientsById.get(id);
    if (client) {
      client.last_seen = `${client.last_seen ?? nowIso}:touched`;
    }
  });

  const registerStandardToolsMock = vi.fn();
  const initializeDatabaseMock = vi.fn();
  const getAppConfigMock = vi.fn(() => ({
    security: {
      enableLogging: true,
      logLevel: 'info',
    },
  }));
  const getUserDataPathMock = vi.fn(() => '/tmp/iki-daemon-tests');
  const setPlatformInfoMock = vi.fn();
  const mkdirSyncMock = vi.fn();
  const writeFileSyncMock = vi.fn();
  const daemonLoggerEventMock = vi.fn();
  const applyAppLoggingConfigMock = vi.fn();

  let requestHandler: ((req: unknown, res: unknown) => unknown | Promise<unknown>) | null = null;
  const serverListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let lastListenPort = 0;
  let lastListenHost = '127.0.0.1';
  const serverMock = {
    listening: false,
    address: vi.fn(() =>
      serverMock.listening
        ? {
            port: lastListenPort,
            address: lastListenHost,
            family: 'IPv4',
          }
        : null
    ),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const listeners = serverListeners.get(event) ?? [];
      listeners.push(handler);
      serverListeners.set(event, listeners);
      return serverMock;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of serverListeners.get(event) ?? []) {
        handler(...args);
      }
    },
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
      lastListenPort = _port;
      lastListenHost = _host;
      serverMock.listening = true;
      callback?.();
      return serverMock;
    }),
    close: vi.fn((callback?: () => void) => {
      serverMock.listening = false;
      callback?.();
      return serverMock;
    }),
  };
  const createServerMock = vi.fn((handler: (req: unknown, res: unknown) => unknown) => {
    requestHandler = handler;
    return serverMock;
  });
  const getRequestHandler = () => requestHandler;
  const resetHttpHarness = () => {
    requestHandler = null;
    serverListeners.clear();
    lastListenPort = 0;
    lastListenHost = '127.0.0.1';
    serverMock.listening = false;
  };

  const chatServiceMock = {
    listThreads: vi.fn(() => []),
    createThread: vi.fn((thread: Record<string, unknown>) => ({ id: 'thread_new', ...thread })),
    listMessages: vi.fn(() => []),
    createMessage: vi.fn((message: Record<string, unknown>) => ({
      id: 'msg_new',
      ...message,
    })),
    send: vi.fn(async (options: Record<string, unknown>) => ({ success: true, echoed: options })),
    stream: vi.fn(async () => ({ success: true })),
    approveTool: vi.fn(async () => ({ success: true })),
    stopStream: vi.fn(() => ({ success: true })),
  };
  const createChatServiceMock = vi.fn(() => chatServiceMock);

  const getChatThreadMock = vi.fn();
  const readOrCreateBootstrapTokenMock = vi.fn(() => currentBootstrapToken());
  const rotateBootstrapTokenMock = vi.fn(() => {
    bootstrapRotation += 1;
    return currentBootstrapToken();
  });

  const mcpManagerMock = {
    initialize: vi.fn(async () => undefined),
    listServers: vi.fn(() => []),
    addServer: vi.fn(async (input: unknown) => input),
    connectServer: vi.fn(async () => ({ connected: true })),
    disconnectServer: vi.fn(async () => undefined),
    refreshTools: vi.fn(async () => []),
    deleteServer: vi.fn(async () => undefined),
    updateServer: vi.fn(async (_id: string, input: unknown) => input),
  };
  const getMcpManagerMock = vi.fn(() => mcpManagerMock);
  const defaultAllowedTools = [
    'web',
    'fetch',
    'read_file',
    'edit',
    'write_file',
    'delete_file',
    'shell',
    'agent',
    'list_personal_skills',
    'read_personal_skill',
    'write_personal_skill',
    'delete_personal_skill',
    'mcp:*',
  ];
  const getDefaultAllowedToolsMock = vi.fn(() => [...defaultAllowedTools]);

  const readRequestedMcpServerIdsMock = vi.fn((payload: Record<string, unknown>) =>
    Array.isArray(payload.mcpServerIds) ? [...(payload.mcpServerIds as string[])] : undefined
  );
  const resolveToolsForClientMock = vi.fn((requested: unknown, allowedTools: string[]) => {
    const requestedTools = Array.isArray(requested)
      ? requested.filter((value): value is string => typeof value === 'string')
      : null;
    if (requestedTools && requestedTools.length === 0) {
      return [];
    }
    if (requestedTools === null) {
      return defaultAllowedTools
        .filter(tool => !tool.startsWith('mcp:'))
        .filter(tool => allowedTools.includes(tool));
    }
    return requestedTools.filter(tool => allowedTools.includes(tool));
  });
  const resolveMcpServerIdsForClientMock = vi.fn((requested: unknown, allowedTools: string[]) => {
    const requestedIds = Array.isArray(requested)
      ? requested.filter((value): value is string => typeof value === 'string')
      : null;
    if (requestedIds && requestedIds.length === 0) {
      return [];
    }
    if (requestedIds === null) {
      return allowedTools.includes('mcp:*') ? ['docs'] : [];
    }
    if (allowedTools.includes('mcp:*')) {
      return requestedIds;
    }
    return requestedIds.filter(serverId => allowedTools.includes(`mcp:server:${serverId}`));
  });


  return {
    resetAppClientState,
    resetBootstrapState,
    createAppClientMock,
    getAppConfigMock,
    getAppClientByIdMock,
    getAppClientByTokenMock,
    listAppClientsMock,
    touchAppClientMock,
    registerStandardToolsMock,
    initializeDatabaseMock,
    getUserDataPathMock,
    setPlatformInfoMock,
    createChatServiceMock,
    chatServiceMock,
    getChatThreadMock,
    getDefaultAllowedToolsMock,
    readOrCreateBootstrapTokenMock,
    rotateBootstrapTokenMock,
    getMcpManagerMock,
    mcpManagerMock,
    readRequestedMcpServerIdsMock,
    resolveMcpServerIdsForClientMock,
    resolveToolsForClientMock,
      mkdirSyncMock,
    writeFileSyncMock,
    daemonLoggerEventMock,
    applyAppLoggingConfigMock,
    createServerMock,
    getRequestHandler,
    resetHttpHarness,
    serverMock,
  };
});

vi.mock('node:http', () => ({
  default: {
    createServer: createServerMock,
  },
  createServer: createServerMock,
}));

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: mkdirSyncMock,
    writeFileSync: writeFileSyncMock,
  },
}));

vi.mock('@iki/backend/tools', () => ({
  registerStandardTools: registerStandardToolsMock,
}));

vi.mock('@iki/backend/mcp', () => ({
  getMcpManager: getMcpManagerMock,
}));

vi.mock('@iki/backend/daemon_logs', () => ({
  createDaemonLogger: vi.fn(() => ({
    event: daemonLoggerEventMock,
  })),
  daemonLog: {
    info: vi.fn(),
  },
}));

vi.mock('@iki/backend/db/database', () => ({
  initializeDatabase: initializeDatabaseMock,
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@iki/backend/logger', () => ({
  createLogger: () => ({
    event: daemonLoggerEventMock,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  applyAppLoggingConfig: applyAppLoggingConfigMock,
  withLogContext: (_context: unknown, fn: () => unknown) => fn(),
  injectGetUserDataPath: vi.fn(),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
  setPlatformInfo: setPlatformInfoMock,
}));

vi.mock('@iki/backend/thread_session', () => ({
  createChatService: createChatServiceMock,
}));

vi.mock('@iki/backend/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
}));

vi.mock('@iki/backend/db/app_clients', () => ({
  createAppClient: createAppClientMock,
  getAppClientById: getAppClientByIdMock,
  getAppClientByToken: getAppClientByTokenMock,
  listAppClients: listAppClientsMock,
  touchAppClient: touchAppClientMock,
}));

vi.mock('@iki/daemon/bootstrap_token', () => ({
  readOrCreateBootstrapToken: readOrCreateBootstrapTokenMock,
  rotateBootstrapToken: rotateBootstrapTokenMock,
}));

vi.mock('@iki/daemon/tool_access', () => ({
  getDefaultAllowedTools: getDefaultAllowedToolsMock,
  readRequestedMcpServerIds: readRequestedMcpServerIdsMock,
  resolveMcpServerIdsForClient: resolveMcpServerIdsForClientMock,
  resolveToolsForClient: resolveToolsForClientMock,
}));

import { startDaemonServer } from '@iki/daemon/server';

type StartedDaemon = ReturnType<typeof startDaemonServer>;

const startedDaemons: StartedDaemon[] = [];

const startTestDaemon = async () => {
  const started = startDaemonServer({ host: '127.0.0.1', port: 0 });
  startedDaemons.push(started);
  return started;
};

const createRequest = (params: {
  method: string;
  url: string;
  headers?: Record<string, string>;
}) => {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: Record<string, string>;
    destroy: ReturnType<typeof vi.fn>;
  };
  req.method = params.method;
  req.url = params.url;
  req.headers = Object.fromEntries(
    Object.entries(params.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  req.destroy = vi.fn();
  return req;
};

const createResponse = () => {
  let body = '';
  const headers = new Map<string, string>();
  const res = {
    statusCode: 200,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
    end: vi.fn((chunk?: string) => {
      body = typeof chunk === 'string' ? chunk : '';
    }),
  };

  return {
    res,
    getBody: () => body,
    getHeaders: () => headers,
  };
};

const requestJson = async (
  _started: StartedDaemon,
  pathname: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }
) => {
  const handler = getRequestHandler();
  if (!handler) {
    throw new Error('Expected daemon request handler to be registered');
  }

  const req = createRequest({
    method: options?.method ?? 'GET',
    url: pathname,
    headers: {
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
  });
  const responseState = createResponse();
  const pending = Promise.resolve(handler(req, responseState.res));

  if (options?.body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(options.body), 'utf8'));
  }
  req.emit('end');

  await pending;
  const text = responseState.getBody();
  return {
    status: responseState.res.statusCode,
    headers: responseState.getHeaders(),
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
};

const requestText = async (
  _started: StartedDaemon,
  pathname: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    bodyText: string;
  }
) => {
  const handler = getRequestHandler();
  if (!handler) {
    throw new Error('Expected daemon request handler to be registered');
  }

  const req = createRequest({
    method: options.method ?? 'POST',
    url: pathname,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const responseState = createResponse();
  const pending = Promise.resolve(handler(req, responseState.res));

  req.emit('data', Buffer.from(options.bodyText, 'utf8'));
  req.emit('end');

  await pending;
  const text = responseState.getBody();
  return {
    status: responseState.res.statusCode,
    headers: responseState.getHeaders(),
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
};

const issueClient = (params: { scopes?: string[]; allowedTools?: string[]; name?: string } = {}) =>
  createAppClientMock({
    name: params.name ?? 'Desktop Client',
    scopes: params.scopes ?? [],
    allowedTools: params.allowedTools ?? [],
  }) as { client: MockAppClient; token: string };

describe('daemon server', () => {
  beforeEach(() => {
    resetAppClientState();
    resetBootstrapState();
    resetHttpHarness();
    vi.clearAllMocks();
    chatServiceMock.listThreads.mockReturnValue([]);
    chatServiceMock.listMessages.mockReturnValue([]);
    mcpManagerMock.addServer.mockImplementation(async (input: unknown) => input);
    getChatThreadMock.mockReset();
    getChatThreadMock.mockReturnValue(null);
    vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    vi.spyOn(process, 'off').mockImplementation((() => process) as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (startedDaemons.length > 0) {
      const started = startedDaemons.pop();
      if (!started) continue;
      started.shutdown();
    }
  });

  it('rejects client registration when the setup token is invalid', async () => {
    const started = await startTestDaemon();

    const result = await requestJson(started, '/v1/clients/register', {
      method: 'POST',
      headers: { 'x-iki-setup-token': 'wrong-token' },
      body: { name: 'Desktop Client' },
    });

    expect(result.status).toBe(401);
    expect(result.json).toEqual({ success: false, error: 'Invalid setup token' });
    expect(createAppClientMock).not.toHaveBeenCalled();
  });

  it('rotates setup tokens on first client registration without reassigning legacy desktop threads', async () => {
    const started = await startTestDaemon();

    const first = await requestJson(started, '/v1/clients/register', {
      method: 'POST',
      headers: { 'x-iki-setup-token': 'setup-token' },
      body: {
        name: '  Desktop Client  ',
        scopes: ['chat:read', 'chat:write'],
        allowed_tools: ['web', 'mcp:server:docs'],
      },
    });

    expect(first.status).toBe(200);
    expect(first.json).toEqual({
      success: true,
      client_id: 'client_1',
      token: 'token_client_1',
      scopes: ['chat:read', 'chat:write'],
      allowed_tools: ['web', 'mcp:server:docs'],
    });
    expect(rotateBootstrapTokenMock).toHaveBeenCalledWith('/tmp/iki-daemon-tests');

    const staleToken = await requestJson(started, '/v1/clients/register', {
      method: 'POST',
      headers: { 'x-iki-setup-token': 'setup-token' },
      body: { name: 'Second Client' },
    });

    expect(staleToken.status).toBe(401);
    expect(staleToken.json).toEqual({ success: false, error: 'Invalid setup token' });

    const rotatedToken = await requestJson(started, '/v1/clients/register', {
      method: 'POST',
      headers: { 'x-iki-setup-token': 'setup-token-rotated-1' },
      body: { name: 'Second Client' },
    });

    expect(rotatedToken.status).toBe(200);
    expect(rotatedToken.json).toEqual({
      success: true,
      client_id: 'client_2',
      token: 'token_client_2',
      scopes: [
        'chat:read',
        'chat:write',
        'tools:run',
        'tools:approve',
        'mcp:read',
        'mcp:write',
      ],
      allowed_tools: [
        'web',
        'fetch',
            'read_file',
        'edit',
        'write_file',
        'delete_file',
        'shell',
        'agent',
        'list_personal_skills',
        'read_personal_skill',
        'write_personal_skill',
        'delete_personal_skill',
        'mcp:*',
      ],
    });
  });

  it('rejects non-object registration payloads instead of silently creating a client', async () => {
    const started = await startTestDaemon();

    const result = await requestJson(started, '/v1/clients/register', {
      method: 'POST',
      headers: { 'x-iki-setup-token': 'setup-token' },
      body: ['Desktop Client'],
    });

    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      success: false,
      error: 'Invalid input: expected object, received array',
    });
    expect(createAppClientMock).not.toHaveBeenCalled();
  });

  it('rejects chat thread listing without auth and when chat:read scope is missing', async () => {
    const started = await startTestDaemon();

    const unauthenticated = await requestJson(started, '/v1/chat/threads');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.json).toEqual({
      success: false,
      error: 'Missing Authorization token',
    });

    const issued = issueClient({ scopes: [] });
    const missingScope = await requestJson(started, '/v1/chat/threads', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(missingScope.status).toBe(403);
    expect(missingScope.json).toEqual({
      success: false,
      error: 'Missing chat:read scope',
    });
    expect(touchAppClientMock).toHaveBeenCalledWith(issued.client.id);
  });

  it('returns only threads owned by the authenticated client', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:read'] });

    chatServiceMock.listThreads.mockReturnValue([
      { id: 'thread_owned', client_id: issued.client.id, title: 'Owned' },
      { id: 'thread_other', client_id: 'client_other', title: 'Other' },
      { id: 'thread_legacy', client_id: null, title: 'Legacy' },
    ]);

    const result = await requestJson(started, '/v1/chat/threads', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      success: true,
      threads: [{ id: 'thread_owned', client_id: issued.client.id, title: 'Owned' }],
    });
  });

  it('exposes the thread workspace binding so a headless client can verify it', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:read'] });

    getChatThreadMock.mockReturnValue({
      id: 'thread_bound',
      client_id: issued.client.id,
      title: 'Bound',
      workspace_id: 'ws-dogfood',
    });
    chatServiceMock.listThreads.mockReturnValue([
      {
        id: 'thread_bound',
        client_id: issued.client.id,
        title: 'Bound',
        workspace_id: 'ws-dogfood',
      },
    ]);

    const single = await requestJson(started, '/v1/chat/threads/thread_bound', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(single.status).toBe(200);
    expect(single.json).toEqual({
      success: true,
      thread: expect.objectContaining({
        id: 'thread_bound',
        workspace_id: 'ws-dogfood',
      }),
    });

    const list = await requestJson(started, '/v1/chat/threads', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(list.status).toBe(200);
    expect(list.json).toEqual({
      success: true,
      threads: [
        expect.objectContaining({ id: 'thread_bound', workspace_id: 'ws-dogfood' }),
      ],
    });
  });

  it('creates a thread already bound to a workspace and rejects a malformed binding', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:write'] });

    const result = await requestJson(started, '/v1/chat/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: { title: 'Dogfood', workspace_id: '  ws-dogfood  ' },
    });

    expect(result.status).toBe(200);
    expect(chatServiceMock.createThread).toHaveBeenCalledWith({
      title: 'Dogfood',
      workspace_id: 'ws-dogfood',
      client_id: issued.client.id,
    });
    expect(result.json).toEqual({
      success: true,
      thread: expect.objectContaining({ workspace_id: 'ws-dogfood' }),
    });

    const rejected = await requestJson(started, '/v1/chat/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: { title: 'Bad', workspace_id: 123 },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.json).toEqual({
      success: false,
      error: expect.stringContaining('workspace_id'),
    });
    expect(chatServiceMock.createThread).toHaveBeenCalledTimes(1);
  });

  it('exposes the thread workspace binding so a headless client can verify it', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:read'] });

    getChatThreadMock.mockReturnValue({
      id: 'thread_bound',
      client_id: issued.client.id,
      title: 'Bound',
      workspace_id: 'ws-dogfood',
    });
    chatServiceMock.listThreads.mockReturnValue([
      {
        id: 'thread_bound',
        client_id: issued.client.id,
        title: 'Bound',
        workspace_id: 'ws-dogfood',
      },
    ]);

    const single = await requestJson(started, '/v1/chat/threads/thread_bound', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(single.status).toBe(200);
    expect(single.json).toEqual({
      success: true,
      thread: expect.objectContaining({
        id: 'thread_bound',
        workspace_id: 'ws-dogfood',
      }),
    });

    const list = await requestJson(started, '/v1/chat/threads', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(list.status).toBe(200);
    expect(list.json).toEqual({
      success: true,
      threads: [
        expect.objectContaining({ id: 'thread_bound', workspace_id: 'ws-dogfood' }),
      ],
    });
  });

  it('creates a thread already bound to a workspace and rejects a malformed binding', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:write'] });

    const result = await requestJson(started, '/v1/chat/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: { title: 'Dogfood', workspace_id: '  ws-dogfood  ' },
    });

    expect(result.status).toBe(200);
    expect(chatServiceMock.createThread).toHaveBeenCalledWith({
      title: 'Dogfood',
      workspace_id: 'ws-dogfood',
      client_id: issued.client.id,
    });
    expect(result.json).toEqual({
      success: true,
      thread: expect.objectContaining({ workspace_id: 'ws-dogfood' }),
    });

    const rejected = await requestJson(started, '/v1/chat/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: { title: 'Bad', workspace_id: 123 },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.json).toEqual({
      success: false,
      error: expect.stringContaining('workspace_id'),
    });
    expect(chatServiceMock.createThread).toHaveBeenCalledTimes(1);
  });

  it('answers CORS preflight requests without requiring authentication', async () => {
    const started = await startTestDaemon();

    const result = await requestJson(started, '/v1/chat/threads', {
      method: 'OPTIONS',
    });

    expect(result.status).toBe(204);
    expect(result.headers.get('access-control-allow-origin')).toBe('*');
    expect(result.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(getAppClientByTokenMock).not.toHaveBeenCalled();
    expect(chatServiceMock.listThreads).not.toHaveBeenCalled();
  });

  it('forces new chat threads to belong to the authenticated client', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:write'] });

    const result = await requestJson(started, '/v1/chat/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: {
        title: 'Owned Thread',
        model: 'gpt-4.1',
        client_id: 'client_other',
      },
    });

    expect(result.status).toBe(200);
    expect(chatServiceMock.createThread).toHaveBeenCalledWith({
      title: 'Owned Thread',
      model: 'gpt-4.1',
      client_id: issued.client.id,
    });
    expect(result.json).toEqual({
      success: true,
      thread: {
        id: 'thread_new',
        title: 'Owned Thread',
        model: 'gpt-4.1',
        client_id: issued.client.id,
      },
    });
  });

  it('rejects invalid non-object chat thread payloads', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:write'] });

    const result = await requestJson(started, '/v1/chat/threads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: ['Owned Thread'],
    });

    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      success: false,
      error: 'Invalid input: expected object, received array',
    });
    expect(chatServiceMock.createThread).not.toHaveBeenCalled();
  });

  it('returns a clear client error for malformed JSON bodies', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:write'] });

    const result = await requestText(started, '/v1/chat/threads', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      bodyText: '{"title":',
    });

    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      success: false,
      error: 'Malformed JSON body',
    });
    expect(chatServiceMock.createThread).not.toHaveBeenCalled();
  });

  it('replays benchmark messages through the daemon message-create endpoint', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:write'] });
    getChatThreadMock.mockReturnValueOnce({
      id: 'thread_owned',
      client_id: issued.client.id,
      title: 'Owned',
    });

    const result = await requestJson(started, '/v1/chat/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: {
        thread_id: 'thread_owned',
        role: 'user',
        content: 'hello',
      },
    });

    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      success: true,
      message: expect.objectContaining({
        id: 'msg_new',
        thread_id: 'thread_owned',
      }),
    });
    expect(chatServiceMock.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread_owned',
        message: {
          role: 'user',
          content: 'hello',
        },
      })
    );
  });

  it('serves no memory routes: the subsystem is removed', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['chat:read'] });

    const result = await requestJson(started, '/v1/memory/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: { query: 'anything' },
    });

    expect(result.status).toBe(404);
  });

  it('rejects invalid MCP server payloads before reaching the manager', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['mcp:write'] });

    const result = await requestJson(started, '/v1/mcp/servers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
      body: {
        name: 'Remote Docs',
        transport: 'streamable-http',
      },
    });

    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      success: false,
      error: 'base_url: base_url is required for remote servers',
    });
    expect(mcpManagerMock.addServer).not.toHaveBeenCalled();
  });

  it('surfaces MCP connect action failures from the manager', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['mcp:write'] });
    mcpManagerMock.connectServer.mockRejectedValueOnce(new Error('connect failed'));

    const result = await requestJson(started, '/v1/mcp/servers/docs/connect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(result.status).toBe(400);
    expect(result.json).toEqual({
      success: false,
      error: 'connect failed',
    });
    expect(mcpManagerMock.connectServer).toHaveBeenCalledWith('docs');
  });

  it('requires mcp:read for refresh-tools and surfaces refresh failures', async () => {
    const started = await startTestDaemon();
    const missingScopeClient = issueClient({ scopes: [] });

    const denied = await requestJson(started, '/v1/mcp/servers/docs/refresh-tools', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${missingScopeClient.token}`,
        'X-Iki-Client': missingScopeClient.client.id,
      },
    });

    expect(denied.status).toBe(403);
    expect(denied.json).toEqual({
      success: false,
      error: 'Missing mcp:read scope',
    });

    const issued = issueClient({ scopes: ['mcp:read'] });
    mcpManagerMock.refreshTools.mockRejectedValueOnce(new Error('refresh failed'));

    const failed = await requestJson(started, '/v1/mcp/servers/docs/refresh-tools', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(failed.status).toBe(400);
    expect(failed.json).toEqual({
      success: false,
      error: 'refresh failed',
    });
    expect(mcpManagerMock.refreshTools).toHaveBeenCalledWith('docs');
  });

  it('routes MCP disconnect and delete actions to the manager for authorized clients', async () => {
    const started = await startTestDaemon();
    const issued = issueClient({ scopes: ['mcp:write'] });

    const disconnected = await requestJson(started, '/v1/mcp/servers/docs/disconnect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(disconnected.status).toBe(200);
    expect(disconnected.json).toEqual({ success: true });
    expect(mcpManagerMock.disconnectServer).toHaveBeenCalledWith('docs');

    const deleted = await requestJson(started, '/v1/mcp/servers/docs/delete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'X-Iki-Client': issued.client.id,
      },
    });

    expect(deleted.status).toBe(200);
    expect(deleted.json).toEqual({ success: true });
    expect(mcpManagerMock.deleteServer).toHaveBeenCalledWith('docs');
  });

  it('exposes idempotent shutdown that disposes the bridge and unregisters signal handlers', async () => {
    const started = await startTestDaemon();

    started.shutdown();
    started.shutdown();

    expect(process.off).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(process.off).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(started.server.close).toHaveBeenCalledTimes(1);
  });

  it('rejects ready and avoids recording daemon location when listen fails', async () => {
    serverMock.listen.mockImplementationOnce(() => {
      queueMicrotask(() => {
        serverMock.emit('error', new Error('EADDRINUSE'));
      });
      return serverMock;
    });

    const started = startDaemonServer({ host: '127.0.0.1', port: 6127 });
    startedDaemons.push(started);

    await expect(started.ready).rejects.toThrow('EADDRINUSE');
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('records the daemon location once listening succeeds', async () => {
    const started = await startTestDaemon();
    startedDaemons.push(started);

    const written = writeFileSyncMock.mock.calls.map(call => String(call[0]));
    expect(written.some(p => p.endsWith('daemon.port'))).toBe(true);
    expect(written.some(p => p.endsWith('daemon.host'))).toBe(true);
  });

  it('survives an unwritable userData dir instead of crashing the process', async () => {
    writeFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });

    const started = startDaemonServer({ host: '127.0.0.1', port: 16199 });
    startedDaemons.push(started);

    expect(started.port).toBe(16199);
    const skipped = daemonLoggerEventMock.mock.calls.filter(
      call => call[0]?.event === 'daemon.server.state_file'
    );
    expect(skipped.length).toBeGreaterThanOrEqual(2);
    expect(skipped[0][0].level).toBe('warn');
  });

});
