import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcListener = (...args: unknown[]) => void;

const { ipcHandlers, fromWebContentsMock, closeMock, setHasShadowMock, createSettingsWindowMock } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcListener>(),
  fromWebContentsMock: vi.fn(),
  closeMock: vi.fn(),
  setHasShadowMock: vi.fn(),
  createSettingsWindowMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock,
  },
  ipcMain: {
    on: vi.fn((channel: string, handler: IpcListener) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../src/main/windows/settings_window', () => ({
  createSettingsWindow: createSettingsWindowMock,
}));

import { registerWindowIpc } from '../../../src/main/ipc/window';

beforeAll(() => {
  registerWindowIpc();
});

beforeEach(() => {
  closeMock.mockReset();
  setHasShadowMock.mockReset();
  fromWebContentsMock.mockReset();
  createSettingsWindowMock.mockReset();
});

describe('window IPC', () => {
  it('updates native shadow state for the sender window', () => {
    fromWebContentsMock.mockReturnValue({
      close: closeMock,
      setHasShadow: setHasShadowMock,
    });

    const handler = ipcHandlers.get('window:set-shadow');
    if (!handler) throw new Error('window:set-shadow handler not registered');

    handler({ sender: { id: 1 } }, true);

    expect(setHasShadowMock).toHaveBeenCalledWith(true);
  });

  it('does not crash when close-window handler receives an unresolvable sender', () => {
    fromWebContentsMock.mockReturnValue(null);

    const handler = ipcHandlers.get('close-window');
    if (!handler) throw new Error('close-window handler not registered');

    expect(() => handler({ sender: { id: 1 } })).not.toThrow();
  });

  it('does not crash when window:set-shadow handler receives an unresolvable sender', () => {
    fromWebContentsMock.mockReturnValue(null);

    const handler = ipcHandlers.get('window:set-shadow');
    if (!handler) throw new Error('window:set-shadow handler not registered');

    expect(() => handler({ sender: { id: 1 } }, true)).not.toThrow();
  });

  it('does not crash when open-settings handler throws during window creation', () => {
    createSettingsWindowMock.mockImplementation(() => {
      throw new Error('Window creation failed');
    });

    const handler = ipcHandlers.get('open-settings');
    if (!handler) throw new Error('open-settings handler not registered');

    expect(() => handler({ sender: { id: 1 } }, 'general')).not.toThrow();
  });
});
