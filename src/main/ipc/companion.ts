import { ipcMain } from 'electron';

import { companionService } from '../services/companion/companion_service';
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
};
