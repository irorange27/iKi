import { ipcMain } from 'electron';

import { toIpcSerializable } from '../../shared/utils/ipc_serialization';
import { getLifeOverview, refreshLifeRuntime } from '../services/life/life_runtime';

let lifeIpcRegistered = false;

export const registerLifeIpc = (): void => {
  if (lifeIpcRegistered) return;
  lifeIpcRegistered = true;

  ipcMain.handle('life:get-overview', (_event, limit?: number) =>
    toIpcSerializable(getLifeOverview(limit))
  );
  ipcMain.handle('life:refresh', async () =>
    toIpcSerializable(await refreshLifeRuntime())
  );
};
