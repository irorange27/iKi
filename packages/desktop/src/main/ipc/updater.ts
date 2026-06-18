import { ipcMain } from 'electron';

import {
  checkForAppUpdates,
  getAppUpdateStatus,
  installDownloadedAppUpdate,
} from '../services/update/auto_update_service';

let updaterIpcRegistered = false;

export const registerUpdaterIpc = (): void => {
  if (updaterIpcRegistered) return;
  updaterIpcRegistered = true;

  ipcMain.handle('updates:get-status', () => getAppUpdateStatus());
  ipcMain.handle('updates:check', () => checkForAppUpdates());
  ipcMain.handle('updates:install', () => {
    return installDownloadedAppUpdate();
  });
};
