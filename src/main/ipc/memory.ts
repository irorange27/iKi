import { ipcMain } from 'electron';

import * as memoryDb from '../../core/db/memory';

let memoryIpcRegistered = false;

export const registerMemoryIpc = (): void => {
  if (memoryIpcRegistered) return;
  memoryIpcRegistered = true;

  ipcMain.handle('memory:short:list', (_event, threadId, limit) =>
    memoryDb.listShortMemory(threadId, limit)
  );
  ipcMain.handle('memory:short:add', (_event, entry) => memoryDb.addShortMemory(entry));
  ipcMain.handle('memory:long:add', (_event, entry) => memoryDb.addLongMemory(entry));
  ipcMain.handle('memory:long:list', (_event, threadId, limit) =>
    memoryDb.listLongMemory(threadId, limit)
  );
  ipcMain.handle('memory:long:search', (_event, threadId, query, options) =>
    memoryDb.searchLongMemory(threadId, query, options)
  );
};

