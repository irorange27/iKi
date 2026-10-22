import { app, ipcMain } from 'electron';

import type { DevRuntimeStatus } from '@iki/backend/types/devtools';

import { restartApp, shouldOfferRestart } from '../windows/app_restart';

let devIpcRegistered = false;

export const isHotReloadAvailable = (devServerUrl: string | undefined): boolean =>
  typeof devServerUrl === 'string' && devServerUrl.trim().length > 0;

const status = (): DevRuntimeStatus => ({
  available: shouldOfferRestart({ isPackaged: app.isPackaged }),
  hotReload: isHotReloadAvailable(process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL),
  isPackaged: app.isPackaged,
  appVersion: app.getVersion(),
  appPath: app.getAppPath(),
});

export const registerDevIpc = (): void => {
  if (devIpcRegistered) return;
  devIpcRegistered = true;

  ipcMain.handle('dev:get-status', () => status());

  ipcMain.handle('dev:restart-app', () => {
    const result = restartApp();
    return { ok: result, reason: result ? undefined : 'packaged-build-cannot-restart' };
  });
};
