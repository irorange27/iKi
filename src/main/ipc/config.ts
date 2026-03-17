import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

import { setConfig, migrateFromJson } from '../../core/db/database';
import { getAppConfig } from '../../core/config';
import { normalizeAppConfig } from '../../shared/config/normalize';

let configIpcRegistered = false;
let configMigrationRun = false;

export const migrateLegacyConfig = (): void => {
  if (configMigrationRun) return;
  configMigrationRun = true;

  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'app-config.json');
  migrateFromJson(configPath, 'app_config');
};

const loadConfig = () => getAppConfig();
const saveConfig = (config: unknown) => setConfig('app_config', normalizeAppConfig(config));

export const registerConfigIpc = (): void => {
  if (configIpcRegistered) return;
  configIpcRegistered = true;

  // Keep migration colocated with config bootstrap so main.ts doesn't have to manage it.
  migrateLegacyConfig();

  ipcMain.handle('config:get', () => {
    return loadConfig();
  });

  ipcMain.handle('config:set', (_event, config) => {
    saveConfig(config);

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('config:updated', config);
    }
    return true;
  });
};
