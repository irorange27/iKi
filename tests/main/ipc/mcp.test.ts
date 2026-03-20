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
  it('forwards add requests to the MCP manager', async () => {
    const handler = ipcHandlers.get('mcp:add');
    if (!handler) throw new Error('mcp:add handler not registered');

    const input = { name: 'Server', transport: 'streamable-http' };
    manager.addServer.mockResolvedValue({ id: 'server_2' });

    await expect(handler(null, input)).resolves.toEqual({ id: 'server_2' });
    expect(manager.addServer).toHaveBeenCalledWith(input);
  });

  it('forwards update requests to the MCP manager', async () => {
    const handler = ipcHandlers.get('mcp:update');
    if (!handler) throw new Error('mcp:update handler not registered');

    const updates = { name: 'Updated name' };
    manager.updateServer.mockResolvedValue({ id: 'server_1', ...updates });

    await expect(handler(null, 'server_1', updates)).resolves.toEqual({
      id: 'server_1',
      ...updates,
    });
    expect(manager.updateServer).toHaveBeenCalledWith('server_1', updates);
  });

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

  it('forwards connect requests to the MCP manager', async () => {
    const handler = ipcHandlers.get('mcp:connect');
    if (!handler) throw new Error('mcp:connect handler not registered');

    manager.connectServer.mockResolvedValue({ state: 'connected', toolCount: 2 });

    await expect(handler(null, 'server_1')).resolves.toEqual({
      state: 'connected',
      toolCount: 2,
    });
    expect(manager.connectServer).toHaveBeenCalledWith('server_1');
  });

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
