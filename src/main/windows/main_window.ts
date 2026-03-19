import { BrowserWindow, app } from 'electron';
import path from 'node:path';

import { maybeOpenDevTools } from './devtools_policy';
import { getRendererDevServerUrl, getRendererProdHtmlPath } from './renderer';

export const createMainWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#2a2d35',
    frame: false,
    // macOS
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, './index.js'),
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(getRendererDevServerUrl());
  } else {
    const indexPath = getRendererProdHtmlPath();
    mainWindow.loadFile(indexPath);
  }

  maybeOpenDevTools(mainWindow.webContents, {
    isPackaged: app.isPackaged,
    autoOpenEnv: process.env.IKI_AUTO_OPEN_DEVTOOLS,
  });

  return mainWindow;
};
