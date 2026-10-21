import { BrowserWindow, ipcMain } from 'electron';

import { createSettingsWindow } from '../windows/settings_window';
import { showMainWindow } from '../windows/main_window';

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
      /* empty: error is not actionable here */
    }
  });

  ipcMain.on('chat:focus-thread', (_event, threadId?: string) => {
    try {
      const mainWindow = showMainWindow();
      if (typeof threadId === 'string' && threadId.trim()) {
        mainWindow.webContents.send('chat:thread-activate', threadId.trim());
      }
    } catch {
      /* empty: error is not actionable here */
    }
  });

  ipcMain.on('close-window', event => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.close();
    } catch {
      /* empty: error is not actionable here */
    }
  });

  ipcMain.on('minimize-window', event => {
    try {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    } catch {
      /* empty: error is not actionable here */
    }
  });

  ipcMain.on('toggle-maximize-window', event => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    } catch {
      /* empty: error is not actionable here */
    }
  });

  ipcMain.on('window:set-shadow', (event, enabled: boolean) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || typeof win.setHasShadow !== 'function') return;
      win.setHasShadow(Boolean(enabled));
    } catch {
      /* empty: error is not actionable here */
    }
  });
};
