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

vi.mock('../../../src/main/services/life/life_runtime', () => ({
  getLifeOverview: vi.fn(),
  refreshLifeRuntime: vi.fn(),
  setLifeOwnerMode: vi.fn(),
  clearLifeOwnerMode: vi.fn(),
}));

import { registerLifeIpc } from '../../../src/main/ipc/life';
import {
  clearLifeOwnerMode,
  getLifeOverview,
  refreshLifeRuntime,
  setLifeOwnerMode,
} from '../../../src/main/services/life/life_runtime';

const clearLifeOwnerModeMock = vi.mocked(clearLifeOwnerMode);
const getLifeOverviewMock = vi.mocked(getLifeOverview);
const refreshLifeRuntimeMock = vi.mocked(refreshLifeRuntime);
const setLifeOwnerModeMock = vi.mocked(setLifeOwnerMode);

beforeAll(() => {
  registerLifeIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('life IPC', () => {
  it('returns the current life overview through IPC', async () => {
    const handler = ipcHandlers.get('life:get-overview');
    if (!handler) throw new Error('life:get-overview handler not registered');

    getLifeOverviewMock.mockReturnValue({
      snapshot: null,
      recentEpisodes: [],
      recentReflections: [],
    });

    const result = await handler(null, 6);

    expect(getLifeOverviewMock).toHaveBeenCalledWith(6);
    expect(result).toEqual({
      snapshot: null,
      recentEpisodes: [],
      recentReflections: [],
    });
  });

  it('refreshes life state through the shared runtime event entrypoint', async () => {
    const handler = ipcHandlers.get('life:refresh');
    if (!handler) throw new Error('life:refresh handler not registered');

    refreshLifeRuntimeMock.mockResolvedValue(null);

    const result = await handler(null);

    expect(refreshLifeRuntimeMock).toHaveBeenCalledWith();
    expect(result).toBeNull();
  });

  it('sets an explicit owner mode through IPC', async () => {
    const handler = ipcHandlers.get('life:set-owner-mode');
    if (!handler) throw new Error('life:set-owner-mode handler not registered');

    setLifeOwnerModeMock.mockReturnValue(null);

    const result = await handler(null, 'focus', null);

    expect(setLifeOwnerModeMock).toHaveBeenCalledWith('focus', null);
    expect(result).toBeNull();
  });

  it('clears the owner mode through IPC', async () => {
    const handler = ipcHandlers.get('life:clear-owner-mode');
    if (!handler) throw new Error('life:clear-owner-mode handler not registered');

    clearLifeOwnerModeMock.mockReturnValue(null);

    const result = await handler(null);

    expect(clearLifeOwnerModeMock).toHaveBeenCalledWith();
    expect(result).toBeNull();
  });
});
