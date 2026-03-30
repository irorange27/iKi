import { ipcMain } from 'electron';

import * as affectDb from '../../core/db/affect_state';
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
  ipcMain.handle('memory:long:add', async (_event, entry) =>
    await memoryDb.addLongMemory(entry, { force: true })
  );
  ipcMain.handle('memory:long:update', async (_event, id, updates) =>
    await memoryDb.updateLongMemory(id, updates)
  );
  ipcMain.handle('memory:long:delete', (_event, id) => memoryDb.deleteLongMemory(id));
  ipcMain.handle('memory:long:list', (_event, threadId, limit) =>
    memoryDb.listLongMemory(threadId, limit)
  );
  ipcMain.handle('memory:long:listAll', (_event, limit) =>
    memoryDb.listLongMemoryAcrossThreads(limit)
  );
  ipcMain.handle('memory:long:search', async (_event, threadId, query, options) =>
    await memoryDb.searchLongMemory(threadId, query, options)
  );
  ipcMain.handle('memory:long:searchAll', async (_event, query, options) =>
    await memoryDb.searchLongMemoryAcrossThreads(query, options)
  );
  ipcMain.handle('memory:affect:get', (_event, threadId) => affectDb.getAffectState(threadId));
};
