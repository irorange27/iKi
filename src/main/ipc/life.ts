import { ipcMain } from 'electron';

import { toIpcSerializable } from '../../shared/utils/ipc_serialization';
import type { LifeOwnerMode } from '../../shared/types/life';
import {
  clearLifeOwnerMode,
  getLifeOverview,
  refreshLifeRuntime,
  setLifeOwnerMode,
} from '../services/life/life_runtime';

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
  ipcMain.handle('life:set-owner-mode', (_event, mode: LifeOwnerMode, note?: string | null) =>
    toIpcSerializable(setLifeOwnerMode(mode, note))
  );
  ipcMain.handle('life:clear-owner-mode', () => toIpcSerializable(clearLifeOwnerMode()));
};
