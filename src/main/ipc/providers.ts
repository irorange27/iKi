import { ipcMain } from 'electron';

import * as providerDb from '../../core/db/providers';

let providersIpcRegistered = false;

export const registerProvidersIpc = (): void => {
  if (providersIpcRegistered) return;
  providersIpcRegistered = true;

  ipcMain.handle('providers:list', () => {
    const providers = providerDb.getProviders();
    return providers;
  });

  ipcMain.handle('providers:get', (_event, id) => providerDb.getProvider(id));

  ipcMain.handle('providers:add', (_event, provider) => {
    try {
      const result = providerDb.addProvider(provider);
      return result;
    } catch (error) {
      console.error('[Main] providers:add error:', error);
      throw error;
    }
  });

  ipcMain.handle('providers:update', (_event, id, provider) => {
    try {
      const result = providerDb.updateProvider(id, provider);
      return result;
    } catch (error) {
      console.error('[Main] providers:update error:', error);
      throw error;
    }
  });

  ipcMain.handle('providers:delete', (_event, id) => providerDb.deleteProvider(id));
};
