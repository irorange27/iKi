import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandlers, fromWebContentsMock, closeMock, setHasShadowMock } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: any[]) => void>(),
  fromWebContentsMock: vi.fn(),
  closeMock: vi.fn(),
  setHasShadowMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock,
  },
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../src/main/windows/settings_window', () => ({
  createSettingsWindow: vi.fn(),
}));

import { registerWindowIpc } from '../../../src/main/ipc/window';

beforeAll(() => {
  registerWindowIpc();
});

beforeEach(() => {
  closeMock.mockReset();
  setHasShadowMock.mockReset();
  fromWebContentsMock.mockReset();
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
});
