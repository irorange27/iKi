import { ipcMain } from 'electron';

import * as providerDb from '../../core/db/providers';
import { createLogger } from '../../core/logger';

let providersIpcRegistered = false;
const providersIpcLogger = createLogger({ module: 'providers_ipc' });

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
      providersIpcLogger.event({
        level: 'error',
        event: 'ipc.providers.add',
        outcome: 'failed',
        error,
      });
      throw error;
    }
  });

  ipcMain.handle('providers:update', (_event, id, provider) => {
    try {
      const result = providerDb.updateProvider(id, provider);
      return result;
    } catch (error) {
      providersIpcLogger.event({
        level: 'error',
        event: 'ipc.providers.update',
        outcome: 'failed',
        error,
        entity: {
          provider_id: typeof id === 'string' ? id : null,
        },
      });
      throw error;
    }
  });

  ipcMain.handle('providers:delete', (_event, id) => providerDb.deleteProvider(id));
};
