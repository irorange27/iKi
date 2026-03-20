import { BrowserWindow, ipcMain } from 'electron';

import { createSettingsWindow } from '../windows/settings_window';

let windowIpcRegistered = false;

export const registerWindowIpc = (): void => {
  if (windowIpcRegistered) return;
  windowIpcRegistered = true;

  ipcMain.on('open-settings', () => {
    createSettingsWindow();
  });

  ipcMain.on('close-window', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.on('window:set-shadow', (event, enabled: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || typeof win.setHasShadow !== 'function') return;
    win.setHasShadow(Boolean(enabled));
  });
};
