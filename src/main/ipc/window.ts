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
};

