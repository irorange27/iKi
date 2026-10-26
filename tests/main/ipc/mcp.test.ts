import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const ipcHandlers = new Map<string, IpcHandler>();

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
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('@iki/backend/mcp', () => ({
  getMcpManager: vi.fn(() => manager),
}));

import { registerMcpIpc } from '../../../packages/desktop/src/main/ipc/mcp';

beforeAll(() => {
  registerMcpIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mcp IPC', () => {
  it('forwards disconnect requests to the MCP manager', async () => {
    const handler = ipcHandlers.get('mcp:disconnect');
    if (!handler) throw new Error('mcp:disconnect handler not registered');

    manager.disconnectServer.mockResolvedValue(undefined);

    await expect(handler(null, 'server_1')).resolves.toEqual({ success: true });
    expect(manager.disconnectServer).toHaveBeenCalledWith('server_1');
  });

  it('forwards delete requests to the MCP manager', async () => {
    const handler = ipcHandlers.get('mcp:delete');
    if (!handler) throw new Error('mcp:delete handler not registered');

    manager.deleteServer.mockResolvedValue(undefined);

    await expect(handler(null, 'server_1')).resolves.toEqual({ success: true });
    expect(manager.deleteServer).toHaveBeenCalledWith('server_1');
  });
});
