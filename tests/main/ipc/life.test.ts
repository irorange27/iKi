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
  recordLifeRuntimeEvent: vi.fn(),
}));

import { registerLifeIpc } from '../../../src/main/ipc/life';
import {
  getLifeOverview,
  recordLifeRuntimeEvent,
} from '../../../src/main/services/life/life_runtime';

const getLifeOverviewMock = vi.mocked(getLifeOverview);
const recordLifeRuntimeEventMock = vi.mocked(recordLifeRuntimeEvent);

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
    });

    const result = await handler(null, 6);

    expect(getLifeOverviewMock).toHaveBeenCalledWith(6);
    expect(result).toEqual({
      snapshot: null,
      recentEpisodes: [],
    });
  });

  it('refreshes life state through the shared runtime event entrypoint', async () => {
    const handler = ipcHandlers.get('life:refresh');
    if (!handler) throw new Error('life:refresh handler not registered');

    recordLifeRuntimeEventMock.mockReturnValue(null);

    const result = await handler(null);

    expect(recordLifeRuntimeEventMock).toHaveBeenCalledWith({
      type: 'manual-refresh',
    });
    expect(result).toBeNull();
  });
});
