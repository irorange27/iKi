import { ipcMain } from 'electron';

import { getAppConfig, setAppConfig } from '@iki/core/config';
import { companionService } from '../services/companion/companion_service';
import { getAllBrowserWindows } from '../utils/browser_windows';
import { syncCompanionWindowToConfig } from '../windows/companion_window';
import { showMainWindow } from '../windows/main_window';

let companionIpcRegistered = false;

export const registerCompanionIpc = (): void => {
  if (companionIpcRegistered) return;
  companionIpcRegistered = true;

  ipcMain.handle('companion:get-snapshot', () => {
    return companionService.getSnapshot();
  });

  ipcMain.handle('companion:open-main-window', () => {
    showMainWindow();
    return { success: true };
  });

  ipcMain.handle('companion:disable', () => {
    const config = getAppConfig();
    if (!config.ui.companion.enabled) {
      return { success: true };
    }

    const nextConfig = {
      ...config,
      ui: {
        ...config.ui,
        companion: {
          ...config.ui.companion,
          enabled: false,
        },
      },
    };

    setAppConfig(nextConfig);
    companionService.refreshAvailability();

    for (const win of getAllBrowserWindows()) {
      win.webContents.send('config:updated', nextConfig);
    }

    syncCompanionWindowToConfig(nextConfig);
    return { success: true };
  });
};
