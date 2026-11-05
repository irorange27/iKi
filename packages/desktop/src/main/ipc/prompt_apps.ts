import { ipcMain } from 'electron';

import * as promptAppDb from '@iki/store/prompt_apps';

let promptAppsIpcRegistered = false;

export const registerPromptAppsIpc = (): void => {
  if (promptAppsIpcRegistered) return;
  promptAppsIpcRegistered = true;

  ipcMain.handle('promptApps:getEnabled', () => promptAppDb.getEnabledPromptApps());
};
