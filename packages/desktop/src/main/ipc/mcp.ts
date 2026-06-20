import { ipcMain } from 'electron';

import { getMcpManager } from '@iki/backend/mcp';
import type { McpServerInput } from '@iki/backend/types/mcp';

let mcpIpcRegistered = false;

export const registerMcpIpc = (): void => {
  if (mcpIpcRegistered) return;
  mcpIpcRegistered = true;

  const manager = getMcpManager();

  ipcMain.handle('mcp:list', () => {
    return manager.listServers();
  });

  ipcMain.handle('mcp:add', async (_event, input: McpServerInput) => {
    return await manager.addServer(input);
  });

  ipcMain.handle('mcp:update', async (_event, id: string, updates: Partial<McpServerInput>) => {
    return await manager.updateServer(id, updates);
  });

  ipcMain.handle('mcp:delete', async (_event, id: string) => {
    await manager.deleteServer(id);
    return { success: true };
  });

  ipcMain.handle('mcp:connect', async (_event, id: string) => {
    return await manager.connectServer(id);
  });

  ipcMain.handle('mcp:disconnect', async (_event, id: string) => {
    await manager.disconnectServer(id);
    return { success: true };
  });

  ipcMain.handle('mcp:refresh-tools', async (_event, id: string) => {
    return await manager.refreshTools(id);
  });
};
