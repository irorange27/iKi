import { ipcMain } from 'electron';

import * as providerDb from '../../core/db/providers';

let providersIpcRegistered = false;

export const registerProvidersIpc = (): void => {
  if (providersIpcRegistered) return;
  providersIpcRegistered = true;

  ipcMain.handle('providers:list', () => {
    const providers = providerDb.getProviders();
    console.log('[Main] providers:list returned:', providers.length, 'providers');
    return providers;
  });

  ipcMain.handle('providers:get', (_event, id) => providerDb.getProvider(id));

  ipcMain.handle('providers:add', (_event, provider) => {
    console.log('[Main] providers:add called with:', provider);
    try {
      const result = providerDb.addProvider(provider);
      console.log('[Main] providers:add result:', result);
      return result;
    } catch (error) {
      console.error('[Main] providers:add error:', error);
      throw error;
    }
  });

  ipcMain.handle('providers:update', (_event, id, provider) => {
    console.log('[Main] providers:update called with id:', id, 'data:', provider);
    try {
      const result = providerDb.updateProvider(id, provider);
      console.log('[Main] providers:update result:', result);
      return result;
    } catch (error) {
      console.error('[Main] providers:update error:', error);
      throw error;
    }
  });

  ipcMain.handle('providers:delete', (_event, id) => providerDb.deleteProvider(id));
};

