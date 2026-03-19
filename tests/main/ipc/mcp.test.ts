import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (...args: any[]) => any>();

const manager = {
  listServers: vi.fn(),
  addServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  connectServer: vi.fn(),
  disconnectServer: vi.fn(),
  refreshTools: vi.fn(),
};

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../src/core/mcp', () => ({
  getMcpManager: vi.fn(() => manager),
}));

import { registerMcpIpc } from '../../../src/main/ipc/mcp';

beforeAll(() => {
  registerMcpIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mcp IPC', () => {
  it('forwards list requests to the MCP manager', async () => {
    const handler = ipcHandlers.get('mcp:list');
    if (!handler) throw new Error('mcp:list handler not registered');

    manager.listServers.mockReturnValue([{ id: 'server_1' }]);

    expect(handler(null)).toEqual([{ id: 'server_1' }]);
    expect(manager.listServers).toHaveBeenCalledTimes(1);
  });

  it('forwards refresh-tools requests to the MCP manager', async () => {
    const handler = ipcHandlers.get('mcp:refresh-tools');
    if (!handler) throw new Error('mcp:refresh-tools handler not registered');

    manager.refreshTools.mockResolvedValue([{ name: 'lookup' }]);

    await expect(handler(null, 'server_1')).resolves.toEqual([{ name: 'lookup' }]);
    expect(manager.refreshTools).toHaveBeenCalledWith('server_1');
  });
});
