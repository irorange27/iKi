import { beforeEach, describe, expect, it, vi } from 'vitest';

type DaemonClientLike = {
  id: string;
  name: string;
  scopes: string[];
  allowedTools: string[];
};

const {
  authenticateWebSocketMock,
  getThreadOrErrorMock,
  hasScopeMock,
  loggerEventMock,
  readRequestedMcpServerIdsMock,
  resolveMcpServerIdsForClientMock,
  resolveToolsForClientMock,
} = vi.hoisted(() => ({
  authenticateWebSocketMock: vi.fn(),
  getThreadOrErrorMock: vi.fn(),
  hasScopeMock: vi.fn((client: DaemonClientLike, scope: string) => client.scopes.includes(scope)),
  loggerEventMock: vi.fn(),
  readRequestedMcpServerIdsMock: vi.fn((payload: { mcpServerIds?: unknown }) =>
    Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds : []
  ),
  resolveMcpServerIdsForClientMock: vi.fn((requested: unknown, allowedTools: string[]) =>
    Array.isArray(requested)
      ? requested.filter(
          (serverId): serverId is string =>
            typeof serverId === 'string' && allowedTools.includes(`mcp:server:${serverId}`)
        )
      : []
  ),
  resolveToolsForClientMock: vi.fn((requested: unknown, allowedTools: string[]) =>
    Array.isArray(requested)
      ? requested.filter(
          (tool): tool is string => typeof tool === 'string' && allowedTools.includes(tool)
        )
      : []
  ),
}));

vi.mock('../../src/daemon/server_shared', () => ({
  authenticateWebSocket: authenticateWebSocketMock,
  getThreadOrError: getThreadOrErrorMock,
  hasScope: hasScopeMock,
}));

vi.mock('../../src/daemon/tool_access', () => ({
  readRequestedMcpServerIds: readRequestedMcpServerIdsMock,
  resolveMcpServerIdsForClient: resolveMcpServerIdsForClientMock,
  resolveToolsForClient: resolveToolsForClientMock,
}));

import { configureDaemonWebSockets } from '../../src/daemon/server_ws';

class FakeRawSocket {
  write = vi.fn();
  destroy = vi.fn();
}

class FakeDaemonSocket {
  readyState = 1;
  sent: string[] = [];
  private listeners = new Map<string, (...args: unknown[]) => unknown>();

  send = vi.fn((data: string) => {
    this.sent.push(data);
  });

  on = vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
    this.listeners.set(event, listener);
  });

  emitMessage(data: unknown) {
    const listener = this.listeners.get('message');
    return listener ? listener(data) : undefined;
  }

  emitClose() {
    const listener = this.listeners.get('close');
    return listener ? listener() : undefined;
  }
}

const createEmitter = () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();

  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(listener);
      listeners.set(event, handlers);
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event) ?? [];
      for (const handler of handlers) {
        handler(...args);
      }
      return handlers.length > 0;
    }),
  };
};

const createClient = (overrides: Partial<DaemonClientLike> = {}): DaemonClientLike => ({
  id: 'client_1',
  name: 'Desktop Client',
  scopes: [],
  allowedTools: [],
  ...overrides,
});

const createHarness = (clientOverrides: Partial<DaemonClientLike> = {}) => {
  const server = createEmitter();
  const wssEmitter = createEmitter();
  const ws = new FakeDaemonSocket();
  const wss = {
    ...wssEmitter,
    close: vi.fn(),
    handleUpgrade: vi.fn(
      (
        _req: unknown,
        _socket: unknown,
        _head: Buffer,
        callback: (socket: FakeDaemonSocket) => void
      ) => {
        callback(ws);
      }
    ),
  };
  const chatService = {
    stream: vi.fn(async () => ({ success: true, stream_id: 'stream_1' })),
    approveTool: vi.fn(async () => ({ success: true })),
    stopStream: vi.fn(() => ({ success: true })),
  };
  const napcatBridge = {
    handleUpgrade: vi.fn(() => false),
  };
  const logger = {
    event: loggerEventMock,
  };
  const sessions = new Map();
  const wsSessions = new Map();
  const nextSessionIdRef = { current: 1 };
  const client = createClient(clientOverrides);

  authenticateWebSocketMock.mockReturnValue({ client });
  getThreadOrErrorMock.mockImplementation((threadId: string, clientId: string) => ({
    thread: { id: threadId, client_id: clientId },
  }));

  configureDaemonWebSockets({
    server: server as never,
    wss: wss as never,
    chatService: chatService as never,
    napcatBridge: napcatBridge as never,
    sessions,
    wsSessions,
    nextSessionIdRef,
    logger,
  });

  const upgradeRequest = {
    url: '/v1/chat/stream?token=token_1&client_id=client_1',
    headers: {},
  };
  const rawSocket = new FakeRawSocket();
  server.emit('upgrade', upgradeRequest, rawSocket, Buffer.alloc(0));

  return {
    server,
    wss,
    ws,
    rawSocket,
    chatService,
    napcatBridge,
    sessions,
    wsSessions,
    nextSessionIdRef,
  };
};

const parseDaemonPayload = (value: string) =>
  JSON.parse(value) as { channel: string; payload: Record<string, unknown> };

describe('configureDaemonWebSockets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized chat stream upgrades', () => {
    const server = createEmitter();
    const wss = {
      ...createEmitter(),
      close: vi.fn(),
      handleUpgrade: vi.fn(),
    };
    const rawSocket = new FakeRawSocket();

    authenticateWebSocketMock.mockReturnValue({ error: 'Missing Authorization token' });

    configureDaemonWebSockets({
      server: server as never,
      wss: wss as never,
      chatService: {
        stream: vi.fn(),
        approveTool: vi.fn(),
        stopStream: vi.fn(),
      } as never,
      napcatBridge: { handleUpgrade: vi.fn(() => false) } as never,
      sessions: new Map(),
      wsSessions: new Map(),
      nextSessionIdRef: { current: 1 },
      logger: { event: loggerEventMock },
    });

    server.emit(
      'upgrade',
      { url: '/v1/chat/stream?client_id=client_1', headers: {} },
      rawSocket,
      Buffer.alloc(0)
    );

    expect(rawSocket.write).toHaveBeenCalledWith('HTTP/1.1 401 Unauthorized\r\n\r\n');
    expect(rawSocket.destroy).toHaveBeenCalledTimes(1);
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
  });

  it('delegates non-chat upgrades to the NapCat bridge and otherwise destroys the socket', () => {
    const server = createEmitter();
    const wss = {
      ...createEmitter(),
      close: vi.fn(),
      handleUpgrade: vi.fn(),
    };
    const napcatBridge = { handleUpgrade: vi.fn(() => true) };
    const rawSocket = new FakeRawSocket();

    configureDaemonWebSockets({
      server: server as never,
      wss: wss as never,
      chatService: {
        stream: vi.fn(),
        approveTool: vi.fn(),
        stopStream: vi.fn(),
      } as never,
      napcatBridge: napcatBridge as never,
      sessions: new Map(),
      wsSessions: new Map(),
      nextSessionIdRef: { current: 1 },
      logger: { event: loggerEventMock },
    });

    server.emit('upgrade', { url: '/onebot/v11/ws', headers: {} }, rawSocket, Buffer.alloc(0));

    expect(napcatBridge.handleUpgrade).toHaveBeenCalledTimes(1);
    expect(rawSocket.destroy).not.toHaveBeenCalled();

    napcatBridge.handleUpgrade.mockReturnValueOnce(false);
    server.emit('upgrade', { url: '/unknown', headers: {} }, rawSocket, Buffer.alloc(0));

    expect(rawSocket.destroy).toHaveBeenCalledTimes(1);
  });

  it('creates a ready session on successful upgrade and cleans it up on close', () => {
    const harness = createHarness({
      scopes: ['chat:write'],
    });

    expect(harness.wss.handleUpgrade).toHaveBeenCalledTimes(1);
    expect(harness.sessions.has(1)).toBe(true);
    expect(harness.wsSessions.get(harness.ws as never)?.id).toBe(1);
    expect(parseDaemonPayload(harness.ws.sent[0])).toEqual({
      channel: 'daemon',
      payload: { type: 'ready', connection_id: 1 },
    });

    harness.ws.emitClose();

    expect(harness.sessions.has(1)).toBe(false);
    expect(harness.wsSessions.has(harness.ws as never)).toBe(false);
  });

  it('rejects start messages when chat:write scope is missing', async () => {
    const harness = createHarness({
      scopes: [],
    });

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'start',
        payload: {
          providerType: 'openai',
          model: 'gpt-4.1',
          messages: [],
        },
      })
    );

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Missing chat:write scope' },
    });
    expect(harness.chatService.stream).not.toHaveBeenCalled();
  });

  it('rejects start messages when thread access is denied', async () => {
    const harness = createHarness({
      scopes: ['chat:write'],
    });
    getThreadOrErrorMock.mockReturnValueOnce({
      status: 403,
      error: 'Thread access denied',
    });

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'start',
        payload: {
          providerType: 'openai',
          model: 'gpt-4.1',
          messages: [],
          thread_id: 'thread_foreign',
        },
      })
    );

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Thread access denied' },
    });
    expect(harness.chatService.stream).not.toHaveBeenCalled();
  });

  it('rejects start messages when tools are requested without tools:run scope', async () => {
    const harness = createHarness({
      scopes: ['chat:write'],
      allowedTools: ['web', 'mcp:server:docs'],
    });

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'start',
        payload: {
          providerType: 'openai',
          model: 'gpt-4.1',
          messages: [],
          tools: ['web'],
          mcpServerIds: ['docs'],
        },
      })
    );

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Missing tools:run scope' },
    });
    expect(harness.chatService.stream).not.toHaveBeenCalled();
  });

  it('streams approved start messages and returns the stream result payload', async () => {
    const harness = createHarness({
      scopes: ['chat:write', 'tools:run'],
      allowedTools: ['web', 'mcp:server:docs'],
    });
    harness.chatService.stream.mockResolvedValueOnce({ success: true, text: 'ok' });

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'start',
        request_id: 'req_1',
        payload: {
          providerType: 'openai',
          model: 'gpt-4.1',
          messages: [{ role: 'user', content: 'hello' }],
          thread_id: 'thread_owned',
          maxIterations: 12,
          tools: ['web', 'shell'],
          mcpServerIds: ['docs', 'other'],
          skillIds: ['skill_1'],
          skillMode: 'manual',
        },
      })
    );

    expect(resolveToolsForClientMock).toHaveBeenCalledWith(
      ['web', 'shell'],
      ['web', 'mcp:server:docs']
    );
    expect(resolveMcpServerIdsForClientMock).toHaveBeenCalledWith(
      ['docs', 'other'],
      ['web', 'mcp:server:docs']
    );
    expect(harness.chatService.stream).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        providerType: 'openai',
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hello' }],
        tools: ['web'],
        mcpServerIds: ['docs'],
        skillIds: ['skill_1'],
        skillMode: 'manual',
        threadId: 'thread_owned',
        maxIterations: 12,
      }
    );
    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: {
        type: 'stream-result',
        request_id: 'req_1',
        success: true,
        text: 'ok',
      },
    });
  });

  it('logs and returns a dedicated error when stream startup fails unexpectedly', async () => {
    const harness = createHarness({
      scopes: ['chat:write'],
    });
    harness.chatService.stream.mockRejectedValueOnce(new Error('stream failed'));

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'start',
        request_id: 'req_failed',
        payload: {
          providerType: 'openai',
          model: 'gpt-4.1',
          messages: [],
        },
      })
    );

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Failed to start stream' },
    });
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'daemon.server.ws.message',
        outcome: 'failed',
        message: 'Daemon WebSocket start request failed unexpectedly.',
        data: expect.objectContaining({
          connection_id: 1,
          client_id: 'client_1',
          message_type: 'start',
          request_id: 'req_failed',
        }),
      })
    );
  });

  it('handles approve-tool and stop messages for authorized sessions', async () => {
    const harness = createHarness({
      scopes: ['chat:write', 'tools:approve'],
    });
    harness.chatService.approveTool.mockResolvedValueOnce({ success: true, approved: true });
    harness.chatService.stopStream.mockReturnValueOnce({ success: true, stopped: true });

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'approve-tool',
        approval_id: 'approval_1',
        approved: true,
      })
    );

    expect(harness.chatService.approveTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'approval_1',
      true
    );
    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: {
        type: 'approve-result',
        approval_id: 'approval_1',
        success: true,
        approved: true,
      },
    });

    await harness.ws.emitMessage(JSON.stringify({ type: 'stop' }));

    expect(harness.chatService.stopStream).toHaveBeenCalledWith(1);
    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: {
        type: 'stop-result',
        success: true,
        stopped: true,
      },
    });
  });

  it('rejects approve-tool messages when tools:approve scope is missing', async () => {
    const harness = createHarness({
      scopes: ['chat:write'],
    });

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'approve-tool',
        approval_id: 'approval_1',
        approved: true,
      })
    );

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Missing tools:approve scope' },
    });
    expect(harness.chatService.approveTool).not.toHaveBeenCalled();
  });

  it('logs dedicated errors when approve-tool or stop handling fails unexpectedly', async () => {
    const harness = createHarness({
      scopes: ['chat:write', 'tools:approve'],
    });
    harness.chatService.approveTool.mockRejectedValueOnce(new Error('approve failed'));
    harness.chatService.stopStream.mockImplementationOnce(() => {
      throw new Error('stop failed');
    });

    await harness.ws.emitMessage(
      JSON.stringify({
        type: 'approve-tool',
        approval_id: 'approval_1',
        approved: true,
      })
    );

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Failed to approve tool request' },
    });

    await harness.ws.emitMessage(JSON.stringify({ type: 'stop' }));

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Failed to stop stream' },
    });
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'daemon.server.ws.message',
        message: 'Daemon WebSocket tool approval failed unexpectedly.',
      })
    );
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'daemon.server.ws.message',
        message: 'Daemon WebSocket stop request failed unexpectedly.',
      })
    );
  });

  it('returns an error payload for malformed websocket messages', async () => {
    const harness = createHarness({
      scopes: ['chat:write'],
    });

    await harness.ws.emitMessage('{not-valid-json');

    expect(parseDaemonPayload(harness.ws.sent.at(-1) || '')).toEqual({
      channel: 'daemon',
      payload: { type: 'error', error: 'Invalid message payload' },
    });
  });
});
