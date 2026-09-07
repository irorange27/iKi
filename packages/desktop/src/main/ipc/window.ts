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
      // Prevent unhandled exceptions from crashing the main process.
    }
  });

  // Focus the main window and have its chat view switch to the given thread
  // (used by the settings window's automations review queue).
  ipcMain.on('chat:focus-thread', (_event, threadId?: string) => {
    try {
      const mainWindow = showMainWindow();
      if (typeof threadId === 'string' && threadId.trim()) {
        mainWindow.webContents.send('chat:thread-activate', threadId.trim());
      }
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
