import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;
type HttpResponseEvent = 'data' | 'end';
type HttpResponseMock = {
  statusCode: number;
  setEncoding: ReturnType<typeof vi.fn>;
  on: (event: HttpResponseEvent, handler: (...args: unknown[]) => void) => HttpResponseMock;
};

const {
  ipcHandlers,
  getPathMock,
  readFileSyncMock,
  httpGetMock,
  readRecentDaemonLogsMock,
  applyAppUpdateConfigMock,
  applyDesktopDaemonConfigUpdateMock,
  getDesktopEmbeddedDaemonStatusMock,
  isDesktopDaemonEmbeddedRunningMock,
  restartDesktopDaemonMock,
  startDesktopDaemonMock,
  stopDesktopDaemonMock,
  testNetworkConnectivityMock,
} = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
  getPathMock: vi.fn((name: string) => {
    if (name === 'userData') return '/tmp/iki-user-data';
    return '/tmp/unknown';
  }),
  readFileSyncMock: vi.fn((filePath: string) => {
    if (filePath.endsWith('/daemon.host')) return '127.0.0.1';
    if (filePath.endsWith('/daemon.port')) return '6131';
    throw new Error(`Unexpected file read: ${filePath}`);
  }),
  httpGetMock: vi.fn(),
  readRecentDaemonLogsMock: vi.fn((limit: number, userDataPath: string) => ({
    filePath: `${userDataPath}/logs/daemon.log`,
    entries: [
      {
        timestamp: '2026-03-19T00:00:00.000Z',
        level: 'info',
        source: 'daemon',
        message: `log tail ${limit}`,
      },
    ],
    napcatMessages: [
      {
        receivedAt: '2026-03-19T00:01:00.000Z',
        messageType: 'private',
        userId: '20002',
        textPreview: 'hello from qq',
        mentionedSelf: true,
        replyEligible: true,
      },
    ],
  })),
  applyAppUpdateConfigMock: vi.fn(),
  applyDesktopDaemonConfigUpdateMock: vi.fn(async () => undefined),
  getDesktopEmbeddedDaemonStatusMock: vi.fn(() => null),
  isDesktopDaemonEmbeddedRunningMock: vi.fn(() => true),
  restartDesktopDaemonMock: vi.fn(),
  startDesktopDaemonMock: vi.fn(),
  stopDesktopDaemonMock: vi.fn(() => true),
  testNetworkConnectivityMock: vi.fn(async (candidate: unknown) => ({
    success: true,
    testedAt: '2026-04-07T00:00:00.000Z',
    effectiveProxy: 'socks5://127.0.0.1:1080',
    error: null,
    results: [
      {
        key: 'internet',
        url: 'https://example.com/',
        success: true,
        statusCode: 200,
        durationMs: 120,
        error: null,
        resolvedProxy: 'SOCKS5 127.0.0.1:1080',
      },
    ],
    candidate,
  })),
}));

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: readFileSyncMock,
  },
  readFileSync: readFileSyncMock,
}));

vi.mock('node:http', () => ({
  default: {
    get: httpGetMock,
  },
  get: httpGetMock,
}));

vi.mock('../../../src/core/db/database', () => ({
  setConfig: vi.fn(),
  migrateFromJson: vi.fn(),
}));

vi.mock('../../../src/core/config', () => ({
  getAppConfig: vi.fn(() => ({
    bridges: {
      napcat: {
        enabled: true,
      },
    },
    daemon: {
      host: '',
      port: 6127,
    },
    mcp: {
      enabled: false,
      connectOnStartup: false,
      allowRemoteServers: false,
      defaultApprovalMode: 'safe-only',
      requestTimeoutMs: 20000,
      maxConcurrentRequests: 4,
    },
  })),
}));

vi.mock('../../../src/core/daemon_logs', () => ({
  readRecentDaemonLogs: readRecentDaemonLogsMock,
}));

vi.mock('../../../src/main/services/daemon/daemon_lifecycle', () => ({
  applyDesktopDaemonConfigUpdate: applyDesktopDaemonConfigUpdateMock,
  getDesktopEmbeddedDaemonStatus: getDesktopEmbeddedDaemonStatusMock,
  isDesktopDaemonEmbeddedRunning: isDesktopDaemonEmbeddedRunningMock,
  restartDesktopDaemon: restartDesktopDaemonMock,
  startDesktopDaemon: startDesktopDaemonMock,
  stopDesktopDaemon: stopDesktopDaemonMock,
}));

vi.mock('../../../src/main/services/update/auto_update_service', () => ({
  applyAppUpdateConfig: applyAppUpdateConfigMock,
}));

vi.mock('../../../src/main/services/network/network_diagnostics', () => ({
  testNetworkConnectivity: testNetworkConnectivityMock,
}));

vi.mock('../../../src/core/mcp', () => ({
  getMcpManager: vi.fn(() => ({
    disconnectAll: vi.fn(),
    initialize: vi.fn(),
    listServers: vi.fn(() => []),
    refreshToolPolicies: vi.fn(),
  })),
}));

vi.mock('../../../src/shared/config/normalize', () => ({
  normalizeAppConfig: vi.fn((config: unknown) => config),
}));

import { registerConfigIpc } from '../../../src/main/ipc/config';

beforeAll(() => {
  registerConfigIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
  getDesktopEmbeddedDaemonStatusMock.mockReturnValue(null);
});

const emptyHeartbeat = {
  lastReceivedAt: null,
  intervalMs: null,
  ageMs: null,
  online: null,
  good: null,
  stale: null,
};

const installHealthResponse = (
  uptimeSeconds: number,
  bridge: Record<string, unknown> = {
    state: 'disconnected',
    activeConnectionCount: 0,
    heartbeat: emptyHeartbeat,
  }
) => {
  httpGetMock.mockImplementation(
    (_options: unknown, callback: (response: HttpResponseMock) => void) => {
      const response: HttpResponseMock = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: (event, handler) => {
          if (event === 'data') {
            handler(
              JSON.stringify({
                status: 'ok',
                host: '127.0.0.1',
                port: 6131,
                uptime: uptimeSeconds,
                bridges: {
                  napcat: bridge,
                },
              })
            );
          }
          if (event === 'end') {
            handler();
          }
          return response;
        },
      };

      callback(response);
      return {
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      };
    }
  );
};

describe('config IPC', () => {
  it('returns runtime info for daemon and NapCat settings', async () => {
    const handler = ipcHandlers.get('config:get-runtime-info');
    if (!handler) throw new Error('config:get-runtime-info handler not registered');

    const result = await handler(null);

    expect(result).toEqual({
      userDataPath: '/tmp/iki-user-data',
      dbPath: '/tmp/iki-user-data/iKi_v0.db',
      daemon: {
        defaultHost: '127.0.0.1',
        defaultPort: 6127,
        configuredHost: '127.0.0.1',
        configuredPort: 6127,
        napcatWsPath: '/onebot/v11/ws',
        localNapCatWsUrl: 'ws://127.0.0.1:6127/onebot/v11/ws',
        dockerNapCatWsUrl: 'ws://host.docker.internal:6127/onebot/v11/ws',
      },
    });
  });

  it('returns online daemon status from the local health endpoint', async () => {
    installHealthResponse(42);

    const handler = ipcHandlers.get('config:get-daemon-status');
    if (!handler) throw new Error('config:get-daemon-status handler not registered');

    const result = await handler(null);

    expect(result).toEqual({
      online: true,
      host: '127.0.0.1',
      port: 6131,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'disconnected',
          activeConnectionCount: 0,
          heartbeat: emptyHeartbeat,
        },
      },
    });
  });

  it('prefers in-process embedded daemon runtime status over localhost probing', async () => {
    getDesktopEmbeddedDaemonStatusMock.mockReturnValue({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 84,
      bridges: {
        napcat: {
          state: 'connected',
          activeConnectionCount: 1,
          heartbeat: {
            lastReceivedAt: '2026-04-22T00:00:00.000Z',
            intervalMs: 5000,
            ageMs: 1200,
            online: true,
            good: true,
            stale: false,
          },
        },
      },
    });

    const handler = ipcHandlers.get('config:get-daemon-status');
    if (!handler) throw new Error('config:get-daemon-status handler not registered');

    const result = await handler(null);

    expect(httpGetMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 84,
      bridges: {
        napcat: {
          state: 'connected',
          activeConnectionCount: 1,
          heartbeat: {
            lastReceivedAt: '2026-04-22T00:00:00.000Z',
            intervalMs: 5000,
            ageMs: 1200,
            online: true,
            good: true,
            stale: false,
          },
        },
      },
    });
  });

  it('falls back to unknown NapCat runtime when daemon health omits bridge details', async () => {
    installHealthResponse(42, {});

    const handler = ipcHandlers.get('config:get-daemon-status');
    if (!handler) throw new Error('config:get-daemon-status handler not registered');

    const result = await handler(null);

    expect(result).toEqual({
      online: true,
      host: '127.0.0.1',
      port: 6131,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'unknown',
          activeConnectionCount: null,
          heartbeat: emptyHeartbeat,
        },
      },
    });
  });

  it('preserves heartbeat-backed degraded bridge runtime from daemon health', async () => {
    installHealthResponse(42, {
      state: 'degraded',
      activeConnectionCount: 1,
      heartbeat: {
        lastReceivedAt: '2026-04-22T00:00:00.000Z',
        intervalMs: 5000,
        ageMs: 11000,
        online: true,
        good: true,
        stale: true,
      },
    });

    const handler = ipcHandlers.get('config:get-daemon-status');
    if (!handler) throw new Error('config:get-daemon-status handler not registered');

    const result = await handler(null);

    expect(result).toEqual({
      online: true,
      host: '127.0.0.1',
      port: 6131,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'degraded',
          activeConnectionCount: 1,
          heartbeat: {
            lastReceivedAt: '2026-04-22T00:00:00.000Z',
            intervalMs: 5000,
            ageMs: 11000,
            online: true,
            good: true,
            stale: true,
          },
        },
      },
    });
  });

  it('returns recent daemon logs from the shared log store', async () => {
    const handler = ipcHandlers.get('config:get-daemon-logs');
    if (!handler) throw new Error('config:get-daemon-logs handler not registered');

    const result = await handler(null, 50);

    expect(readRecentDaemonLogsMock).toHaveBeenCalledWith(50, '/tmp/iki-user-data');
    expect(result).toEqual({
      filePath: '/tmp/iki-user-data/logs/daemon.log',
      entries: [
        {
          timestamp: '2026-03-19T00:00:00.000Z',
          level: 'info',
          source: 'daemon',
          message: 'log tail 50',
        },
      ],
      napcatMessages: [
        {
          receivedAt: '2026-03-19T00:01:00.000Z',
          messageType: 'private',
          userId: '20002',
          textPreview: 'hello from qq',
          mentionedSelf: true,
          replyEligible: true,
        },
      ],
    });
  });

  it('controls the desktop-managed daemon and returns updated status', async () => {
    installHealthResponse(99);

    const handler = ipcHandlers.get('config:control-daemon');
    if (!handler) throw new Error('config:control-daemon handler not registered');

    const result = await handler(null, 'restart');

    expect(restartDesktopDaemonMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      action: 'restart',
      message: 'Daemon restarted and is online at 127.0.0.1:6131.',
      status: {
        online: true,
        host: '127.0.0.1',
        port: 6131,
        status: 'ok',
        source: 'health',
        uptimeSeconds: 99,
        bridges: {
          napcat: {
            state: 'disconnected',
            activeConnectionCount: 0,
            heartbeat: emptyHeartbeat,
          },
        },
      },
      embeddedRunning: true,
    });
  });

  it('tests network connectivity with the candidate network config payload', async () => {
    const handler = ipcHandlers.get('config:test-network');
    if (!handler) throw new Error('config:test-network handler not registered');

    const candidate = {
      proxy: {
        enable: true,
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: 'user',
        password: 'secret',
      },
      webSearch: {
        preferredEngine: 'google',
      },
      timeout: 5000,
      retryAttempts: 3,
    };

    const result = await handler(null, candidate);

    expect(testNetworkConnectivityMock).toHaveBeenCalledWith(candidate);
    expect(result).toMatchObject({
      success: true,
      effectiveProxy: 'socks5://127.0.0.1:1080',
    });
  });

  it('applies updater config when settings are saved', async () => {
    const handler = ipcHandlers.get('config:set');
    if (!handler) throw new Error('config:set handler not registered');

    const nextConfig = {
      general: {
        autoUpdate: false,
      },
      daemon: {
        host: '127.0.0.1',
        port: 6127,
      },
      mcp: {
        enabled: false,
        connectOnStartup: false,
        allowRemoteServers: false,
        defaultApprovalMode: 'safe-only',
        requestTimeoutMs: 20000,
        maxConcurrentRequests: 4,
      },
    };

    await handler(null, nextConfig);

    expect(applyAppUpdateConfigMock).toHaveBeenCalledWith(nextConfig);
  });
});
