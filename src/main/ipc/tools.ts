import { ipcMain } from 'electron';

import { createLogger } from '../../core/logger';
import { defaultToolRegistry } from '../../core/tools';

let toolsIpcRegistered = false;
const toolsIpcLogger = createLogger({ module: 'tools_ipc' });

export const registerToolsIpc = (): void => {
  if (toolsIpcRegistered) return;
  toolsIpcRegistered = true;

  ipcMain.handle('tools:list', () => {
    try {
      return defaultToolRegistry.getToolMetadata();
    } catch (error: unknown) {
      toolsIpcLogger.event({
        level: 'error',
        event: 'ipc.tools.list',
        outcome: 'failed',
        error,
      });
      return [];
    }
  });
};
