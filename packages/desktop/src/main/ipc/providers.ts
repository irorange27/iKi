import { ipcMain } from 'electron';

import * as providerDb from '@iki/backend/db/providers';
import { createLogger } from '@iki/backend/logger';
import type { ProviderUpdatedEvent } from '@iki/backend/types/provider';
import { broadcastToRenderers, withIpcLogging } from '../utils/ipc_helpers';
import { companionService } from '../services/companion/companion_service';

let providersIpcRegistered = false;
const providersIpcLogger = createLogger({ module: 'providers_ipc' });
const PROVIDERS_UPDATED_CHANNEL = 'providers:updated';

const refreshCompanionAvailability = (): void => {
  try {
    companionService.refreshAvailability();
  } catch (error) {
    providersIpcLogger.warn('Failed to refresh companion availability after provider update.', error);
  }
};

const broadcastProviderUpdate = (payload: ProviderUpdatedEvent): void => {
  broadcastToRenderers(PROVIDERS_UPDATED_CHANNEL, payload);
  refreshCompanionAvailability();
};

export const registerProvidersIpc = (): void => {
  if (providersIpcRegistered) return;
  providersIpcRegistered = true;

  ipcMain.handle('providers:list', () => {
    const providers = providerDb.getProviders();
    return providers;
  });

  ipcMain.handle('providers:get', (_event, id) => providerDb.getProvider(id));

  ipcMain.handle('providers:add', (_event, provider) =>
    withIpcLogging(
      providersIpcLogger,
      'ipc.providers.add',
      () => {
        const result = providerDb.addProvider(provider);
        broadcastProviderUpdate({
          action: 'added',
          providerId: provider.id,
        });
        return result;
      },
      {
        onError: error => {
          throw error;
        },
      }
    )
  );

  ipcMain.handle('providers:update', (_event, id, provider) =>
    withIpcLogging(
      providersIpcLogger,
      'ipc.providers.update',
      () => {
        const result = providerDb.updateProvider(id, provider);
        broadcastProviderUpdate({
          action: 'updated',
          providerId: id,
        });
        return result;
      },
      {
        entity: { provider_id: typeof id === 'string' ? id : null },
        onError: error => {
          throw error;
        },
      }
    )
  );

  ipcMain.handle('providers:delete', (_event, id) => {
    const result = providerDb.deleteProvider(id);
    broadcastProviderUpdate({
      action: 'deleted',
      providerId: id,
    });
    return result;
  });
};
