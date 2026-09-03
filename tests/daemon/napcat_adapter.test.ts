import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultAppConfig } from '@iki/backend/config/defaults';

const { daemonLoggerEventMock, recordNapCatMessagePreviewMock } = vi.hoisted(() => ({
  daemonLoggerEventMock: vi.fn(),
  recordNapCatMessagePreviewMock: vi.fn(),
}));

class FakeBridgeSocket {
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
    return this.emit('message', data);
  }

  emit(event: string, ...args: unknown[]) {
    const listener = this.listeners.get(event);
    if (!listener) return undefined;
    return listener(...args);
  }
}

vi.mock('@iki/backend/config', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('@iki/backend/db/providers', () => ({
  getProviders: vi.fn(),
}));

vi.mock('@iki/backend/db/prompt_apps', () => ({
  getEnabledPromptApps: vi.fn(() => []),
}));

vi.mock('@iki/backend/tools/skills', () => ({
  listSkills: vi.fn(async () => []),
}));

vi.mock('@iki/backend/daemon_logs', () => ({
  createDaemonLogger: vi.fn(() => ({
    event: daemonLoggerEventMock,
  })),
  recordNapCatMessagePreview: recordNapCatMessagePreviewMock,
  daemonLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@iki/backend/thread_session/ui_messages', () => ({
  parseStoredUiMessageRow: vi.fn((row: { message: string }) => JSON.parse(row.message)),
}));

import { getAppConfig } from '@iki/backend/config';
import { getProviders } from '@iki/backend/db/providers';
import { getEnabledPromptApps } from '@iki/backend/db/prompt_apps';
import { listSkills } from '@iki/backend/tools/skills';
import { createNapCatReverseBridge } from '@iki/daemon/napcat_adapter';

const getAppConfigMock = vi.mocked(getAppConfig);
const getProvidersMock = vi.mocked(getProviders);
const getEnabledPromptAppsMock = vi.mocked(getEnabledPromptApps);
const listSkillsMock = vi.mocked(listSkills);

const ORIGINAL_ENV = { ...process.env };

const createProvider = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'provider_1',
  name: 'OpenAI',
  type: 'openai',
  api_key: 'sk-test',
  models: JSON.stringify(['gpt-4.1-mini']),
  enabled: true,
  created_at: '2026-03-19T00:00:00.000Z',
  updated_at: '2026-03-19T00:00:00.000Z',
  available_models: JSON.stringify(['gpt-4.1-mini']),
  ...overrides,
});

const createConfig = (napcatOverrides: Partial<ReturnType<typeof createDefaultAppConfig>['bridges']['napcat']> = {}) => {
  const config = createDefaultAppConfig();
  config.bridges.napcat = {
    ...config.bridges.napcat,
    ...napcatOverrides,
  };
  return config;
};

const createChatServiceMock = () => ({
  getThread: vi.fn(),
  createThread: vi.fn(),
  clearThread: vi.fn(),
  updateThread: vi.fn(),
  deleteThread: vi.fn(),
  createMessage: vi.fn(),
  listMessages: vi.fn(),
  send: vi.fn(),
});

const createRequest = (
  url: string,
  headers: Record<string, string | undefined> = {}
) => ({ url, headers });

const createUpgradeSocket = () => ({
  write: vi.fn(),
  destroy: vi.fn(),
});

const connectBridge = (chatService: ReturnType<typeof createChatServiceMock>) => {
  const bridge = createNapCatReverseBridge({
    chatService: chatService as never,
    clientId: 'client_napcat',
  });
  const ws = new FakeBridgeSocket();
  const req = createRequest('/onebot/v11/ws');
  bridge.wss.emit('connection', ws as never, req as never);
  return {
    bridge,
    handled: true,
    ws,
  };
};

const expectSocket = (socket: FakeBridgeSocket | null | undefined): FakeBridgeSocket => {
  if (!socket) {
    throw new Error('Expected NapCat bridge socket to be available.');
  }
  return socket;
};

const flushBridgeAsync = async (cycles = 3) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

const emptyHeartbeat = {
  lastReceivedAt: null,
  intervalMs: null,
  ageMs: null,
  online: null,
  good: null,
  stale: null,
};

const emptyBridgeHistory = {
  lastConnectedAt: null,
  lastDisconnectedAt: null,
};

describe('createNapCatReverseBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.IKI_NAPCAT_ACCESS_TOKEN;
    delete process.env.IKI_NAPCAT_TOKEN;
    delete process.env.IKI_NAPCAT_PROVIDER;
    delete process.env.IKI_NAPCAT_MODEL;
    delete process.env.IKI_NAPCAT_TOOLS;
    delete process.env.IKI_NAPCAT_REQUIRE_MENTION;
    getEnabledPromptAppsMock.mockReturnValue([]);
    listSkillsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('treats reverse WebSocket transport as the primary runtime connection state and heartbeat as secondary health', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T00:00:00.000Z'));

    getAppConfigMock.mockReturnValue(createConfig({ enabled: true }));
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const bridge = createNapCatReverseBridge({
      chatService: chatService as never,
      clientId: 'client_napcat',
    });

    expect(bridge.getStatus()).toEqual({
      state: 'disconnected',
      activeConnectionCount: 0,
      ...emptyBridgeHistory,
      heartbeat: emptyHeartbeat,
    });

    const ws = new FakeBridgeSocket();
    bridge.wss.emit('connection', ws as never, createRequest('/onebot/v11/ws') as never);

    expect(bridge.getStatus()).toEqual({
      state: 'connected',
      activeConnectionCount: 1,
      lastConnectedAt: '2026-04-22T00:00:00.000Z',
      lastDisconnectedAt: null,
      heartbeat: emptyHeartbeat,
    });

    ws.emitMessage(
      JSON.stringify({
        post_type: 'meta_event',
        meta_event_type: 'heartbeat',
        interval: 5000,
        status: {
          online: true,
          good: true,
        },
      })
    );

    expect(bridge.getStatus()).toEqual({
      state: 'connected',
      activeConnectionCount: 1,
      lastConnectedAt: '2026-04-22T00:00:00.000Z',
      lastDisconnectedAt: null,
      heartbeat: {
        lastReceivedAt: '2026-04-22T00:00:00.000Z',
        intervalMs: 5000,
        ageMs: 0,
        online: true,
        good: true,
        stale: false,
      },
    });

    vi.setSystemTime(new Date('2026-04-22T00:00:11.000Z'));

    expect(bridge.getStatus()).toEqual({
      state: 'connected',
      activeConnectionCount: 1,
      lastConnectedAt: '2026-04-22T00:00:00.000Z',
      lastDisconnectedAt: null,
      heartbeat: {
        lastReceivedAt: '2026-04-22T00:00:00.000Z',
        intervalMs: 5000,
        ageMs: 11000,
        online: true,
        good: true,
        stale: true,
      },
    });

    ws.emit('close');

    expect(bridge.getStatus()).toEqual({
      state: 'disconnected',
      activeConnectionCount: 0,
      lastConnectedAt: '2026-04-22T00:00:00.000Z',
      lastDisconnectedAt: '2026-04-22T00:00:11.000Z',
      heartbeat: emptyHeartbeat,
    });

    vi.setSystemTime(new Date('2026-04-22T00:00:15.000Z'));

    const ws2 = new FakeBridgeSocket();
    bridge.wss.emit('connection', ws2 as never, createRequest('/onebot/v11/ws') as never);

    expect(bridge.getStatus()).toEqual({
      state: 'connected',
      activeConnectionCount: 1,
      lastConnectedAt: '2026-04-22T00:00:15.000Z',
      lastDisconnectedAt: '2026-04-22T00:00:11.000Z',
      heartbeat: emptyHeartbeat,
    });
  });

  it('reports disabled bridge status even when no sockets are connected', () => {
    getAppConfigMock.mockReturnValue(createConfig({ enabled: false }));
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const bridge = createNapCatReverseBridge({
      chatService: chatService as never,
      clientId: 'client_napcat',
    });

    expect(bridge.getStatus()).toEqual({
      state: 'disabled',
      activeConnectionCount: 0,
      ...emptyBridgeHistory,
      heartbeat: emptyHeartbeat,
    });
  });

  it('rejects upgrade requests when the bridge is disabled', () => {
    getAppConfigMock.mockReturnValue(createConfig({ enabled: false }));
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const bridge = createNapCatReverseBridge({
      chatService: chatService as never,
      clientId: 'client_napcat',
    });
    const socket = createUpgradeSocket();

    const handled = bridge.handleUpgrade(
      createRequest('/onebot/v11/ws') as never,
      socket as never,
      Buffer.alloc(0)
    );

    expect(handled).toBe(true);
    expect(socket.write).toHaveBeenCalledWith('HTTP/1.1 404 Not Found\r\n\r\n');
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects upgrade requests with an invalid token', () => {
    getAppConfigMock.mockReturnValue(createConfig({ enabled: true, accessToken: 'secret-token' }));
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const bridge = createNapCatReverseBridge({
      chatService: chatService as never,
      clientId: 'client_napcat',
    });
    const socket = createUpgradeSocket();

    const handled = bridge.handleUpgrade(
      createRequest('/onebot/v11/ws?access_token=wrong-token') as never,
      socket as never,
      Buffer.alloc(0)
    );

    expect(handled).toBe(true);
    expect(socket.write).toHaveBeenCalledWith('HTTP/1.1 401 Unauthorized\r\n\r\n');
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses environment fallback for upgrade auth when persisted token is empty', () => {
    process.env.IKI_NAPCAT_TOKEN = 'env-token';

    getAppConfigMock.mockReturnValue(createConfig({ enabled: true, accessToken: '' }));
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const bridge = createNapCatReverseBridge({
      chatService: chatService as never,
      clientId: 'client_napcat',
    });
    const socket = createUpgradeSocket();

    const handled = bridge.handleUpgrade(
      createRequest('/onebot/v11/ws?access_token=wrong-token') as never,
      socket as never,
      Buffer.alloc(0)
    );

    expect(handled).toBe(true);
    expect(socket.write).toHaveBeenCalledWith('HTTP/1.1 401 Unauthorized\r\n\r\n');
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('creates a thread, forwards configured tools, and sends private replies', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        tools: ['web', 'fetch'],
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue(null);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_user_1',
        message: JSON.stringify({
          role: 'user',
          parts: [{ type: 'text', text: 'hello from qq' }],
        }),
      },
    ]);
    chatService.send.mockResolvedValue({ success: true, text: 'hello from iki' });

    const { handled, ws } = connectBridge(chatService);
    const socket = expectSocket(ws);

    expect(handled).toBe(true);
    expect(socket).toBeTruthy();

    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm1',
        message: 'hello from qq',
      })
    ) as Promise<void>;

    await flushBridgeAsync();

    expect(chatService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'napcat_10001_private_20002',
        title: 'QQ User 20002',
        client_id: 'client_napcat',
      })
    );
    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        tools: ['web', 'fetch'],
        threadId: 'napcat_10001_private_20002',
      })
    );
    expect(recordNapCatMessagePreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'private',
        userId: '20002',
        textPreview: 'hello from qq',
        mentionedSelf: false,
        replyEligible: true,
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message: 'hello from iki',
      },
    });

    await (socket.emitMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: outbound.echo,
      })
    ) as Promise<void>);
    await inbound;

    expect(chatService.createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        thread_id: 'napcat_10001_private_20002',
      })
    );
    expect(chatService.createMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        thread_id: 'napcat_10001_private_20002',
      })
    );
  });

  it('filters NapCat tools down to the safe non-interactive web subset', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        tools: ['web', 'shell', 'fetch'],
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue(null);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_user_safe_tools',
        message: JSON.stringify({
          role: 'user',
          parts: [{ type: 'text', text: 'hello from qq' }],
        }),
      },
    ]);
    chatService.send.mockResolvedValue({ success: true, text: 'hello from iki' });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_safe_tools',
        message: 'hello from qq',
      })
    ) as Promise<void>;

    await flushBridgeAsync();

    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['web', 'fetch'],
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('expands prompt-app slash commands before sending NapCat messages to the model', async () => {
    getEnabledPromptAppsMock.mockReturnValue([
      {
        id: 'prompt_summarize',
        name: 'Summarize',
        prompt_template: 'Summarize carefully:\n{{input}}',
        placeholders: '[]',
        enabled: 1,
        sort_order: 0,
        created_at: '2026-04-22T00:00:00.000Z',
        updated_at: '2026-04-22T00:00:00.000Z',
        expects_image_result: 0,
        is_incognito: 0,
        shortcut: 'summarize',
      },
    ] as never);
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue({
      id: 'napcat_10001_private_20002',
      title: 'QQ User 20002',
      metadata: '{}',
      is_incognito: 0,
    } as never);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_user_prompt_app',
        message: JSON.stringify({
          role: 'user',
          parts: [
            {
              type: 'data-composer-invocation',
              data: {
                tokens: [
                  {
                    id: 'prompt_summarize',
                    kind: 'prompt-app',
                    prefix: '',
                    label: 'summarize',
                    title: 'Summarize',
                  },
                ],
              },
            },
            { type: 'text', text: 'Summarize carefully:\nRelease notes draft' },
          ],
        }),
      },
    ]);
    chatService.send.mockResolvedValue({ success: true, text: 'summary result' });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_prompt_app',
        message: '/summarize Release notes draft',
      })
    ) as Promise<void>;

    await flushBridgeAsync();

    expect(chatService.createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        thread_id: 'napcat_10001_private_20002',
        message: {
          role: 'user',
          parts: [
            {
              type: 'data-composer-invocation',
              data: {
                tokens: [
                  expect.objectContaining({
                    id: 'prompt_summarize',
                    kind: 'prompt-app',
                    label: 'summarize',
                  }),
                ],
              },
            },
            { type: 'text', text: 'Summarize carefully:\nRelease notes draft' },
          ],
        },
      })
    );
    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'napcat_10001_private_20002',
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('replies to /start with setup guidance when the bridge has no usable provider/model path', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: '',
        model: '',
      })
    );
    getProvidersMock.mockReturnValue([
      createProvider({
        id: 'provider_without_models',
        name: 'OpenAI',
        type: 'openai',
        models: '[]',
      }),
    ] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue(null);
    chatService.listMessages.mockReturnValue([]);

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_start_setup',
        message: '/start',
      })
    ) as Promise<void>;

    await Promise.resolve();

    expect(chatService.createThread).not.toHaveBeenCalled();
    expect(chatService.createMessage).not.toHaveBeenCalled();
    expect(chatService.send).not.toHaveBeenCalled();

    const outbound = JSON.parse(socket.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message:
          'iKi is not ready on this bridge yet. In the desktop app, enable one working provider and make sure at least one model is available, then send /start again or just send a normal message.',
      },
    });

    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('treats /start with arguments as a normal first request once the bridge is ready', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue({
      id: 'napcat_10001_private_20002',
      title: 'QQ User 20002',
      metadata: '{}',
      is_incognito: 0,
    } as never);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_user_start',
        message: JSON.stringify({
          role: 'user',
          parts: [{ type: 'text', text: 'Help me plan the release checklist' }],
        }),
      },
    ]);
    chatService.send.mockResolvedValue({ success: true, text: 'release plan ready' });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_start_task',
        message: '/start Help me plan the release checklist',
      })
    ) as Promise<void>;

    await flushBridgeAsync();

    expect(chatService.createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        thread_id: 'napcat_10001_private_20002',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'Help me plan the release checklist' }],
        },
      })
    );
    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'napcat_10001_private_20002',
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('routes skill slash commands through manual skill selection before sending', async () => {
    listSkillsMock.mockResolvedValue([
      {
        id: 'codex:frontend-dev',
        name: 'frontend-dev',
        description: 'Frontend work',
        source: 'codex',
        path: '/skills/frontend-dev/SKILL.md',
      },
    ] as never);
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue({
      id: 'napcat_10001_private_20002',
      title: 'QQ User 20002',
      metadata: '{}',
      is_incognito: 0,
    } as never);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_user_skill',
        message: JSON.stringify({
          role: 'user',
          parts: [
            {
              type: 'data-composer-invocation',
              data: {
                tokens: [
                  {
                    id: 'skill:codex:frontend-dev',
                    kind: 'skill',
                    prefix: '$',
                    label: 'frontend-dev',
                    title: 'Frontend work',
                  },
                ],
              },
            },
            { type: 'text', text: 'Polish the bridge settings card' },
          ],
        }),
      },
    ]);
    chatService.send.mockResolvedValue({ success: true, text: 'skill result' });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_skill',
        message: '/frontend-dev Polish the bridge settings card',
      })
    ) as Promise<void>;

    await flushBridgeAsync();

    expect(chatService.createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: {
          role: 'user',
          parts: [
            {
              type: 'data-composer-invocation',
              data: {
                tokens: [
                  expect.objectContaining({
                    id: 'skill:codex:frontend-dev',
                    kind: 'skill',
                    prefix: '$',
                    label: 'frontend-dev',
                  }),
                ],
              },
            },
            { type: 'text', text: 'Polish the bridge settings card' },
          ],
        },
      })
    );
    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        skillMode: 'manual',
        skillIds: ['codex:frontend-dev'],
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('executes /incognito locally for the NapCat thread instead of sending it to the model', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: '',
        model: '',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue({
      id: 'napcat_10001_private_20002',
      title: 'QQ User 20002',
      metadata: '{}',
      is_incognito: 0,
    } as never);
    chatService.listMessages.mockReturnValue([]);

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_incognito',
        message: '/incognito on',
      })
    ) as Promise<void>;

    await Promise.resolve();

    expect(chatService.updateThread).toHaveBeenCalledWith('napcat_10001_private_20002', {
      is_incognito: 1,
    });
    expect(chatService.send).not.toHaveBeenCalled();
    expect(chatService.createMessage).not.toHaveBeenCalled();

    const outbound = JSON.parse(socket.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message: 'Incognito mode is now enabled.',
      },
    });

    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('resets the bridge thread on /clear without carrying old context into the next task', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue({
      id: 'napcat_10001_private_20002',
      title: 'Release Ops',
      metadata: JSON.stringify({
        source: 'napcat',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
      }),
      client_id: 'client_napcat',
      is_incognito: 1,
      workspace_id: 'workspace_release',
      prompt_app_id: 'prompt_summarize',
      skill_ids: '["codex:frontend-dev"]',
    } as never);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_before_clear',
        message: JSON.stringify({
          role: 'user',
          parts: [{ type: 'text', text: 'Old task context' }],
        }),
      },
    ]);

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_clear',
        message: '/clear',
      })
    ) as Promise<void>;

    await Promise.resolve();

    expect(chatService.clearThread).toHaveBeenCalledWith('napcat_10001_private_20002', {
      id: 'napcat_10001_private_20002',
      title: 'Release Ops',
      metadata: JSON.stringify({
        source: 'napcat',
        message_type: 'private',
        self_id: '10001',
        group_id: undefined,
        user_id: '20002',
      }),
      client_id: 'client_napcat',
      is_incognito: 1,
      workspace_id: 'workspace_release',
    });
    expect(chatService.createThread).not.toHaveBeenCalled();
    expect(chatService.createMessage).not.toHaveBeenCalled();
    expect(chatService.send).not.toHaveBeenCalled();

    const outbound = JSON.parse(socket.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message: 'Context cleared. You can start a fresh task now.',
      },
    });

    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('formats markdown replies into QQ-friendly plain text before persisting and sending', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        tools: ['web', 'fetch'],
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue(null);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_user_markdown_reply',
        message: JSON.stringify({
          role: 'user',
          parts: [{ type: 'text', text: 'today news' }],
        }),
      },
    ]);
    chatService.send.mockResolvedValue({
      success: true,
      text: '# Daily Brief\n- **BBC**\n- [OpenAI](https://openai.com)',
    });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm_markdown_reply',
        message: 'today news',
      })
    ) as Promise<void>;

    await Promise.resolve();

    expect(chatService.createMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        thread_id: 'napcat_10001_private_20002',
        metadata: '{}',
        message: expect.objectContaining({
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'Daily Brief\n• BBC\n• OpenAI (https://openai.com)',
            },
          ],
        }),
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message: 'Daily Brief\n• BBC\n• OpenAI (https://openai.com)',
      },
    });

    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('ignores group messages without @mention when mention gate is enabled', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        requireMention: true,
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue(null);
    chatService.listMessages.mockReturnValue([]);

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    await (socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: '10001',
        user_id: '20002',
        group_id: '30003',
        message_id: 'm2',
        message: 'hello everyone',
      })
    ) as Promise<void>);

    expect(chatService.createThread).not.toHaveBeenCalled();
    expect(chatService.createMessage).not.toHaveBeenCalled();
    expect(chatService.send).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([]);
  });

  it('accepts CQ-code @mentions in group string payloads when mention gate is enabled', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        requireMention: true,
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue(null);
    chatService.listMessages.mockReturnValue([]);
    chatService.send.mockResolvedValue({ success: true, text: 'group reply' });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: '10001',
        user_id: '20002',
        group_id: '30003',
        message_id: 'm2b',
        message: '[CQ:at,qq=10001] hello group',
      })
    ) as Promise<void>;

    await Promise.resolve();

    expect(chatService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'napcat_10001_group_30003',
        title: 'QQ Group 30003',
        client_id: 'client_napcat',
      })
    );
    expect(chatService.createMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        thread_id: 'napcat_10001_group_30003',
        message: {
          role: 'user',
          parts: [{ type: 'text', text: '@10001 hello group' }],
        },
      })
    );
    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4.1-mini',
        threadId: 'napcat_10001_group_30003',
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_group_msg',
      params: {
        group_id: '30003',
        message: 'group reply',
      },
    });

    await (socket.emitMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: outbound.echo,
      })
    ) as Promise<void>);
    await inbound;
  });

  it('uses environment fallback for model and tools when persisted values are empty', async () => {
    process.env.IKI_NAPCAT_TOKEN = 'env-token';
    process.env.IKI_NAPCAT_PROVIDER = 'openai';
    process.env.IKI_NAPCAT_MODEL = 'gpt-env';
    process.env.IKI_NAPCAT_TOOLS = 'web, fetch, web';

    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        accessToken: '',
        providerType: '',
        model: '',
        tools: [],
      })
    );
    getProvidersMock.mockReturnValue([
      createProvider({
        models: JSON.stringify(['gpt-env']),
        available_models: JSON.stringify(['gpt-env']),
      }),
    ] as never);

    const chatService = createChatServiceMock();
    chatService.getThread.mockReturnValue(null);
    chatService.listMessages.mockReturnValue([
      {
        id: 'msg_user_2',
        message: JSON.stringify({
          role: 'user',
          parts: [{ type: 'text', text: 'fallback test' }],
        }),
      },
    ]);
    chatService.send.mockResolvedValue({ success: true, text: 'fallback ok' });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);
    const inbound = socket.emitMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        self_id: '10001',
        user_id: '20002',
        message_id: 'm3',
        message: 'fallback test',
      })
    ) as Promise<void>;

    await Promise.resolve();

    expect(chatService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-env',
        tools: ['web', 'fetch'],
      })
    );

    const outbound = JSON.parse(socket.sent[0]);
    await (socket.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await inbound;
  });

  it('can send proactive output into an existing NapCat thread', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const { bridge, ws } = connectBridge(chatService);

    const outboundPromise = bridge.sendThreadMessage({
      thread: {
        id: 'napcat_10001_private_20002',
        title: 'QQ User 20002',
        metadata: JSON.stringify({
          source: 'napcat',
          message_type: 'private',
          user_id: '20002',
        }),
      } as never,
      text: 'scheduled hello',
    });

    await Promise.resolve();

    const outbound = JSON.parse(ws.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message: 'scheduled hello',
      },
    });

    await (ws.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await outboundPromise;
  });

  it('formats proactive markdown output before sending it to NapCat', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const { bridge, ws } = connectBridge(chatService);

    const outboundPromise = bridge.sendThreadMessage({
      thread: {
        id: 'napcat_10001_private_20002',
        title: 'QQ User 20002',
        metadata: JSON.stringify({
          source: 'napcat',
          message_type: 'private',
          user_id: '20002',
        }),
      } as never,
      text: '## Daily\n- **Item**\n- [BBC](https://bbc.com)',
    });

    await Promise.resolve();

    const outbound = JSON.parse(ws.sent[0]);
    expect(outbound).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '20002',
        message: 'Daily\n• Item\n• BBC (https://bbc.com)',
      },
    });

    await (ws.emitMessage(JSON.stringify({ status: 'ok', retcode: 0, echo: outbound.echo })) as
      Promise<void>);
    await outboundPromise;
  });

  it('rejects proactive bridge sends when NapCat returns a failed action response', async () => {
    getAppConfigMock.mockReturnValue(
      createConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      })
    );
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    const { bridge, ws } = connectBridge(chatService);

    const outboundPromise = bridge.sendThreadMessage({
      thread: {
        id: 'napcat_10001_private_20002',
        title: 'QQ User 20002',
        metadata: JSON.stringify({
          source: 'napcat',
          message_type: 'private',
          user_id: '20002',
        }),
      } as never,
      text: 'scheduled hello',
    });

    await Promise.resolve();

    const outbound = JSON.parse(ws.sent[0]);
    await (ws.emitMessage(
      JSON.stringify({ status: 'failed', retcode: 100, echo: outbound.echo })
    ) as Promise<void>);

    await expect(outboundPromise).rejects.toThrow(
      'NapCat action send_private_msg failed (status=failed, retcode=100)'
    );
  });

  it('logs a warning when receiving malformed JSON instead of silently dropping it', () => {
    getAppConfigMock.mockReturnValue(createConfig({ enabled: true }));
    getProvidersMock.mockReturnValue([createProvider()] as never);

    const chatService = createChatServiceMock();
    chatService.send.mockResolvedValue({ success: true, text: 'ok' });

    const { ws } = connectBridge(chatService);
    const socket = expectSocket(ws);

    // Send malformed JSON
    socket.emitMessage('{not-valid');

    expect(daemonLoggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'napcat.ws.message',
        outcome: 'failed',
        message: 'Received malformed JSON from NapCat WebSocket.',
      })
    );
  });
});
