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

vi.mock('../../../src/main/services/relationship/relationship_service', () => ({
  getRelationshipOverview: vi.fn(),
}));

import { registerRelationshipIpc } from '../../../src/main/ipc/relationship';
import { getRelationshipOverview } from '../../../src/main/services/relationship/relationship_service';

const getRelationshipOverviewMock = vi.mocked(getRelationshipOverview);

beforeAll(() => {
  registerRelationshipIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('relationship IPC', () => {
  it('returns relationship overview through IPC', async () => {
    const handler = ipcHandlers.get('relationship:get-overview');
    if (!handler) throw new Error('relationship:get-overview handler not registered');

    getRelationshipOverviewMock.mockReturnValue({
      owner: {
        owner_label: 'Nina',
        relationship_to_owner: 'trusted personal AI companion',
      },
      recentStates: [],
    });

    const result = await handler(null, 6);

    expect(getRelationshipOverviewMock).toHaveBeenCalledWith(6);
    expect(result).toEqual({
      owner: {
        owner_label: 'Nina',
        relationship_to_owner: 'trusted personal AI companion',
      },
      recentStates: [],
    });
  });
});
