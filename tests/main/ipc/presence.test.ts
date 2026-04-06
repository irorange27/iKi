import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const ipcHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../src/main/services/presence/presence_runtime', () => ({
  getPresenceOverview: vi.fn(),
  refreshPresenceRuntime: vi.fn(),
  setPresenceOwnerMode: vi.fn(),
  clearPresenceOwnerMode: vi.fn(),
}));

import { registerPresenceIpc } from '../../../src/main/ipc/presence';
import {
  clearPresenceOwnerMode,
  getPresenceOverview,
  refreshPresenceRuntime,
  setPresenceOwnerMode,
} from '../../../src/main/services/presence/presence_runtime';

const clearPresenceOwnerModeMock = vi.mocked(clearPresenceOwnerMode);
const getPresenceOverviewMock = vi.mocked(getPresenceOverview);
const refreshPresenceRuntimeMock = vi.mocked(refreshPresenceRuntime);
const setPresenceOwnerModeMock = vi.mocked(setPresenceOwnerMode);

beforeAll(() => {
  registerPresenceIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('presence IPC', () => {
  it('returns the current presence overview through IPC', async () => {
    const handler = ipcHandlers.get('presence:get-overview');
    if (!handler) throw new Error('presence:get-overview handler not registered');

    getPresenceOverviewMock.mockReturnValue({
      snapshot: null,
      recentEpisodes: [],
      recentReflections: [],
    });

    const result = await handler(null, 6);

    expect(getPresenceOverviewMock).toHaveBeenCalledWith(6);
    expect(result).toEqual({
      snapshot: null,
      recentEpisodes: [],
      recentReflections: [],
    });
  });

  it('refreshes presence state through the shared runtime event entrypoint', async () => {
    const handler = ipcHandlers.get('presence:refresh');
    if (!handler) throw new Error('presence:refresh handler not registered');

    refreshPresenceRuntimeMock.mockResolvedValue(null);

    const result = await handler(null);

    expect(refreshPresenceRuntimeMock).toHaveBeenCalledWith();
    expect(result).toBeNull();
  });

  it('sets an explicit owner mode through IPC', async () => {
    const handler = ipcHandlers.get('presence:set-owner-mode');
    if (!handler) throw new Error('presence:set-owner-mode handler not registered');

    setPresenceOwnerModeMock.mockReturnValue(null);

    const result = await handler(null, 'focus', null);

    expect(setPresenceOwnerModeMock).toHaveBeenCalledWith('focus', null);
    expect(result).toBeNull();
  });

  it('clears the owner mode through IPC', async () => {
    const handler = ipcHandlers.get('presence:clear-owner-mode');
    if (!handler) throw new Error('presence:clear-owner-mode handler not registered');

    clearPresenceOwnerModeMock.mockReturnValue(null);

    const result = await handler(null);

    expect(clearPresenceOwnerModeMock).toHaveBeenCalledWith();
    expect(result).toBeNull();
  });
});
