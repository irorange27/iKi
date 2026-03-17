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
  ipcMain.handle('memory:short:listAll', (_event, limit) =>
    memoryDb.listShortMemoryAcrossThreads(limit)
  );
  ipcMain.handle('memory:long:add', (_event, entry) => memoryDb.addLongMemory(entry));
  ipcMain.handle('memory:long:list', (_event, threadId, limit) =>
    memoryDb.listLongMemory(threadId, limit)
  );
  ipcMain.handle('memory:long:listAll', (_event, limit) =>
    memoryDb.listLongMemoryAcrossThreads(limit)
  );
  ipcMain.handle('memory:long:search', (_event, threadId, query, options) =>
    memoryDb.searchLongMemory(threadId, query, options)
  );
  ipcMain.handle('memory:long:searchAll', (_event, query, options) =>
    memoryDb.searchLongMemoryAcrossThreads(query, options)
  );
};
