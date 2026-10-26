import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const {
  ipcHandlers,
  refreshAvailabilityMock,
  showMainWindowMock,
  getAppConfigMock,
  setAppConfigMock,
  syncCompanionWindowToConfigMock,
  getAllBrowserWindowsMock,
  sendMock,
} = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
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

vi.mock('../../../packages/desktop/src/main/services/companion/companion_service', () => ({
  companionService: {
    refreshAvailability: refreshAvailabilityMock,
  },
}));

vi.mock('../../../packages/desktop/src/main/windows/main_window', () => ({
  showMainWindow: showMainWindowMock,
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
  setAppConfig: setAppConfigMock,
}));

vi.mock('../../../packages/desktop/src/main/windows/companion_window', () => ({
  syncCompanionWindowToConfig: syncCompanionWindowToConfigMock,
}));

vi.mock('../../../packages/desktop/src/main/utils/browser_windows', () => ({
  getAllBrowserWindows: getAllBrowserWindowsMock,
}));

import { registerCompanionIpc } from '../../../packages/desktop/src/main/ipc/companion';

beforeAll(() => {
  registerCompanionIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('companion IPC', () => {
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
