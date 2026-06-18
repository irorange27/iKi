import { BrowserWindow, ipcMain } from 'electron';

import { createSettingsWindow } from '../windows/settings_window';

let windowIpcRegistered = false;

export const registerWindowIpc = (): void => {
  if (windowIpcRegistered) return;
  windowIpcRegistered = true;

  ipcMain.on('open-settings', (_event, section?: string) => {
    try {
      createSettingsWindow({
        section: typeof section === 'string' ? section : undefined,
      });
    } catch {
      // Prevent unhandled exceptions from crashing the main process.
    }
  });

  ipcMain.on('close-window', event => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.close();
    } catch {
      // Prevent unhandled exceptions from crashing the main process.
    }
  });

  ipcMain.on('window:set-shadow', (event, enabled: boolean) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || typeof win.setHasShadow !== 'function') return;
      win.setHasShadow(Boolean(enabled));
    } catch {
      // Prevent unhandled exceptions from crashing the main process.
    }
  });
};
