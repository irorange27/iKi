import { beforeAll, describe, expect, it, vi } from 'vitest';

const { ipcHandlers, getPathMock, readFileSyncMock, httpGetMock } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: any[]) => any>(),
  getPathMock: vi.fn((name: string) => {
    if (name === 'userData') return '/tmp/iki-user-data';
    return '/tmp/unknown';
  }),
  readFileSyncMock: vi.fn((filePath: string) => {
    if (filePath.endsWith('/daemon.host')) return '0.0.0.0';
    if (filePath.endsWith('/daemon.port')) return '6131';
    throw new Error(`Unexpected file read: ${filePath}`);
  }),
  httpGetMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
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

describe('config IPC', () => {
  it('returns runtime info for daemon and NapCat settings', async () => {
    const handler = ipcHandlers.get('config:get-runtime-info');
    if (!handler) throw new Error('config:get-runtime-info handler not registered');

    const result = await handler(null);

    expect(result).toEqual({
      userDataPath: '/tmp/iki-user-data',
      dbPath: '/tmp/iki-user-data/iKi_v0.db',
      daemon: {
        defaultHost: '0.0.0.0',
        defaultPort: 6127,
        configuredHost: '0.0.0.0',
        configuredPort: 6127,
        napcatWsPath: '/onebot/v11/ws',
        localNapCatWsUrl: 'ws://0.0.0.0:6127/onebot/v11/ws',
        dockerNapCatWsUrl: 'ws://host.docker.internal:6127/onebot/v11/ws',
      },
    });
  });

  it('returns online daemon status from the local health endpoint', async () => {
    httpGetMock.mockImplementation((_options: unknown, callback: (response: any) => void) => {
      const response = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (event === 'data') {
            handler('{"status":"ok","host":"0.0.0.0","port":6131,"uptime":42}');
          }
          if (event === 'end') {
            handler();
          }
          return response;
        }),
      };

      callback(response);
      return {
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      };
    });

    const handler = ipcHandlers.get('config:get-daemon-status');
    if (!handler) throw new Error('config:get-daemon-status handler not registered');

    const result = await handler(null);

    expect(result).toEqual({
      online: true,
      host: '0.0.0.0',
      port: 6131,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
    });
  });
});
