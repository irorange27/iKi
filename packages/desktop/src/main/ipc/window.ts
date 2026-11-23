import { BrowserWindow, ipcMain } from 'electron';

let windowIpcRegistered = false;

export const registerWindowIpc = (): void => {
  if (windowIpcRegistered) return;
  windowIpcRegistered = true;

  ipcMain.on('close-window', event => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.close();
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
