import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultAppConfig } from '../../src/shared/config/defaults';

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
    const listener = this.listeners.get('message');
    if (!listener) return undefined;
    return listener(data);
  }
}

vi.mock('../../src/core/config', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('../../src/core/db/providers', () => ({
  getProviders: vi.fn(),
}));

vi.mock('../../src/core/daemon_logs', () => ({
  createDaemonLogger: vi.fn(() => ({
    event: vi.fn(),
  })),
  daemonLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/main/services/chat/chat_ui', () => ({
  parseStoredUiMessageRow: vi.fn((row: { message: string }) => JSON.parse(row.message)),
}));

import { getAppConfig } from '../../src/core/config';
import { getProviders } from '../../src/core/db/providers';
import { createNapCatReverseBridge } from '../../src/daemon/napcat_adapter';

const getAppConfigMock = vi.mocked(getAppConfig);
const getProvidersMock = vi.mocked(getProviders);

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
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

    await Promise.resolve();

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

    await Promise.resolve();

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
});
