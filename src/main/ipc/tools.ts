import { ipcMain } from 'electron';

import { defaultToolRegistry } from '../../core/tools';

let toolsIpcRegistered = false;

export const registerToolsIpc = (): void => {
  if (toolsIpcRegistered) return;
  toolsIpcRegistered = true;

  ipcMain.handle('tools:list', () => {
    try {
      return defaultToolRegistry.getToolMetadata();
    } catch (error: unknown) {
      console.error('Failed to list tools:', error);
      return [];
    }
  });
};

