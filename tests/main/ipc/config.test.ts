import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const { ipcHandlers, getAllWindowsMock, getPathMock, applyAppUpdateConfigMock } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
  getPathMock: vi.fn((name: string) => {
    if (name === 'userData') return '/tmp/iki-user-data';
    return '/tmp/unknown';
  }),
  applyAppUpdateConfigMock: vi.fn(),
  getAllWindowsMock: vi.fn(() => []),
}));

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('@iki/backend/db/database', () => ({
  setConfig: vi.fn(),
  migrateFromJson: vi.fn(),
  getStorePath: () => '/tmp/iki-user-data/iki-store',
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: vi.fn(() => ({
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

vi.mock('../../../packages/desktop/src/main/services/update/auto_update_service', () => ({
  applyAppUpdateConfig: applyAppUpdateConfigMock,
}));

vi.mock('../../../packages/desktop/src/main/services/network/network_diagnostics', () => ({
  testNetworkConnectivity: vi.fn(),
}));

vi.mock('@iki/backend/mcp', () => ({
  getMcpManager: vi.fn(() => ({
    disconnectAll: vi.fn(),
    initialize: vi.fn(),
    listServers: vi.fn(() => []),
    refreshToolPolicies: vi.fn(),
  })),
}));

vi.mock('@iki/backend/config/normalize', () => ({
  normalizeAppConfig: vi.fn((config: unknown) => config),
}));

import { registerConfigIpc } from '../../../packages/desktop/src/main/ipc/config';

beforeAll(() => {
  registerConfigIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('config IPC', () => {
  it('returns runtime info for the config surface', async () => {
    const handler = ipcHandlers.get('config:get-runtime-info');
    if (!handler) throw new Error('config:get-runtime-info handler not registered');

    const result = await handler(null);

    expect(result).toEqual({
      userDataPath: '/tmp/iki-user-data',
      storePath: expect.any(String),
    });
  });

  it('applies updater config when settings are saved', async () => {
    const handler = ipcHandlers.get('config:set');
    if (!handler) throw new Error('config:set handler not registered');

    const nextConfig = {
      general: {
        autoUpdate: false,
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

  it('broadcasts config:updated to all windows after side effects and tolerates destroyed webContents', async () => {
    const handler = ipcHandlers.get('config:set');
    if (!handler) throw new Error('config:set handler not registered');

    const send1 = vi.fn();
    const send2 = vi.fn();
    const send3 = vi.fn();

    send2.mockImplementation(() => {
      throw new Error('Object has been destroyed');
    });

    getAllWindowsMock.mockReturnValue([
      { webContents: { send: send1 } },
      { webContents: { send: send2 } },
      { webContents: { send: send3 } },
    ]);

    const nextConfig = {
      general: { autoUpdate: false },
      mcp: {
        enabled: false,
        connectOnStartup: false,
        allowRemoteServers: false,
        defaultApprovalMode: 'safe-only',
        requestTimeoutMs: 20000,
        maxConcurrentRequests: 4,
      },
    };

    const result = await handler(null, nextConfig);

    expect(result).toBe(true);
    expect(send1).toHaveBeenCalledWith('config:updated', nextConfig);
    expect(send2).toHaveBeenCalledWith('config:updated', nextConfig);
    expect(send3).toHaveBeenCalledWith('config:updated', nextConfig);
  });
});
