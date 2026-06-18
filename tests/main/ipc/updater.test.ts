import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const { ipcHandlers, getAppUpdateStatusMock, checkForAppUpdatesMock, installDownloadedAppUpdateMock } =
  vi.hoisted(() => ({
    ipcHandlers: new Map<string, IpcHandler>(),
    getAppUpdateStatusMock: vi.fn(() => ({
      state: 'idle',
      autoUpdateEnabled: true,
      supported: true,
      checkIntervalMs: 21600000,
      currentVersion: '0.0.1',
      lastCheckedAt: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      updateUrl: null,
      error: null,
      unsupportedReason: null,
    })),
    checkForAppUpdatesMock: vi.fn(() => ({
      state: 'checking',
      autoUpdateEnabled: true,
      supported: true,
      checkIntervalMs: 21600000,
      currentVersion: '0.0.1',
      lastCheckedAt: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      updateUrl: null,
      error: null,
      unsupportedReason: null,
    })),
    installDownloadedAppUpdateMock: vi.fn(() => Promise.resolve({ success: true })),
  }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../packages/desktop/src/main/services/update/auto_update_service', () => ({
  getAppUpdateStatus: getAppUpdateStatusMock,
  checkForAppUpdates: checkForAppUpdatesMock,
  installDownloadedAppUpdate: installDownloadedAppUpdateMock,
}));

import { registerUpdaterIpc } from '../../../packages/desktop/src/main/ipc/updater';

beforeAll(() => {
  registerUpdaterIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updater IPC', () => {
  it('returns the current updater status', async () => {
    const handler = ipcHandlers.get('updates:get-status');
    if (!handler) throw new Error('updates:get-status handler not registered');

    const result = await handler(null);

    expect(getAppUpdateStatusMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        state: 'idle',
        currentVersion: '0.0.1',
      })
    );
  });

  it('triggers manual update checks', async () => {
    const handler = ipcHandlers.get('updates:check');
    if (!handler) throw new Error('updates:check handler not registered');

    const result = await handler(null);

    expect(checkForAppUpdatesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ state: 'checking' }));
  });

  it('installs a downloaded update when requested', async () => {
    const handler = ipcHandlers.get('updates:install');
    if (!handler) throw new Error('updates:install handler not registered');

    const result = await handler(null);

    expect(installDownloadedAppUpdateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });
});
