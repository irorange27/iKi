import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const {
  ipcHandlers,
  getSnapshotMock,
  refreshAvailabilityMock,
  showMainWindowMock,
  getAppConfigMock,
  setAppConfigMock,
  syncCompanionWindowToConfigMock,
  getAllBrowserWindowsMock,
  sendMock,
} = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
  getSnapshotMock: vi.fn(),
  refreshAvailabilityMock: vi.fn(),
  showMainWindowMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  setAppConfigMock: vi.fn(),
  syncCompanionWindowToConfigMock: vi.fn(),
  getAllBrowserWindowsMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../src/main/services/companion/companion_service', () => ({
  companionService: {
    getSnapshot: getSnapshotMock,
    refreshAvailability: refreshAvailabilityMock,
  },
}));

vi.mock('../../../src/main/windows/main_window', () => ({
  showMainWindow: showMainWindowMock,
}));

vi.mock('../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
  setAppConfig: setAppConfigMock,
}));

vi.mock('../../../src/main/windows/companion_window', () => ({
  syncCompanionWindowToConfig: syncCompanionWindowToConfigMock,
}));

vi.mock('../../../src/main/utils/browser_windows', () => ({
  getAllBrowserWindows: getAllBrowserWindowsMock,
}));

import { registerCompanionIpc } from '../../../src/main/ipc/companion';

beforeAll(() => {
  registerCompanionIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('companion IPC', () => {
  it('returns the current companion snapshot', async () => {
    const snapshot = {
      phase: 'idle',
      label: 'Ready',
      headline: 'Here',
      detail: 'Waiting',
      updatedAt: '2026-04-12T00:00:00.000Z',
    };
    getSnapshotMock.mockReturnValue(snapshot);

    const handler = ipcHandlers.get('companion:get-snapshot');
    if (!handler) throw new Error('companion:get-snapshot handler not registered');

    expect(handler()).toEqual(snapshot);
  });

  it('shows the main window on request', async () => {
    const handler = ipcHandlers.get('companion:open-main-window');
    if (!handler) throw new Error('companion:open-main-window handler not registered');

    expect(handler()).toEqual({ success: true });
    expect(showMainWindowMock).toHaveBeenCalledTimes(1);
  });

  it('disables the companion window persistently and broadcasts config updates', async () => {
    getAppConfigMock.mockReturnValue({
      ui: {
        companion: {
          enabled: true,
          alwaysOnTop: true,
          rememberPosition: true,
          reduceMotion: false,
          openMainWindowOnClick: true,
          position: { x: 12, y: 18 },
        },
      },
    });
    getAllBrowserWindowsMock.mockReturnValue([
      { webContents: { send: sendMock } },
      { webContents: { send: sendMock } },
    ]);

    const handler = ipcHandlers.get('companion:disable');
    if (!handler) throw new Error('companion:disable handler not registered');

    expect(handler()).toEqual({ success: true });

    expect(setAppConfigMock).toHaveBeenCalledWith({
      ui: {
        companion: {
          enabled: false,
          alwaysOnTop: true,
          rememberPosition: true,
          reduceMotion: false,
          openMainWindowOnClick: true,
          position: { x: 12, y: 18 },
        },
      },
    });
    expect(refreshAvailabilityMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      'config:updated',
      expect.objectContaining({
        ui: expect.objectContaining({
          companion: expect.objectContaining({
            enabled: false,
          }),
        }),
      })
    );
    expect(syncCompanionWindowToConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ui: expect.objectContaining({
          companion: expect.objectContaining({
            enabled: false,
          }),
        }),
      })
    );
  });
});
