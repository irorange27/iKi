import { BrowserWindow, app } from 'electron';
import path from 'node:path';

import { maybeOpenDevTools } from './devtools_policy';
import { loadRendererEntry } from './renderer';

export const createMainWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#2a2d35',
    // Start shadow-free until the renderer resolves the active theme and opts in for light mode.
    hasShadow: false,
    frame: false,
    // macOS
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, './index.js'),
      nodeIntegration: false,
    },
  });

  void loadRendererEntry(mainWindow, { isPackaged: app.isPackaged });

  maybeOpenDevTools(mainWindow.webContents, {
    isPackaged: app.isPackaged,
    autoOpenEnv: process.env.IKI_AUTO_OPEN_DEVTOOLS,
  });

  return mainWindow;
};
