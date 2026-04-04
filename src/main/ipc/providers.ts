import { ipcMain } from 'electron';

import * as providerDb from '../../core/db/providers';
import { createLogger } from '../../core/logger';
import type { ProviderUpdatedEvent } from '../../shared/types/provider';
import { getAllBrowserWindows } from '../utils/browser_windows';

let providersIpcRegistered = false;
const providersIpcLogger = createLogger({ module: 'providers_ipc' });
const PROVIDERS_UPDATED_CHANNEL = 'providers:updated';

const broadcastProviderUpdate = (payload: ProviderUpdatedEvent): void => {
  for (const win of getAllBrowserWindows()) {
    win.webContents.send(PROVIDERS_UPDATED_CHANNEL, payload);
  }
};

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
      broadcastProviderUpdate({
        action: 'added',
        providerId: provider.id,
      });
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
      broadcastProviderUpdate({
        action: 'updated',
        providerId: id,
      });
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

  ipcMain.handle('providers:delete', (_event, id) => {
    const result = providerDb.deleteProvider(id);
    broadcastProviderUpdate({
      action: 'deleted',
      providerId: id,
    });
    return result;
  });
};
