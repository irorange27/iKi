import { BrowserWindow, app } from 'electron';
import path from 'node:path';

import { maybeOpenDevTools } from './devtools_policy';
import { getRendererDevServerUrl, getRendererProdHtmlPath } from './renderer';

export const createSettingsWindow = (): BrowserWindow => {
  const settingsWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#2a2d35',
    hasShadow: false,
    title: 'Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, './index.js'),
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  if (!app.isPackaged) {
    const devUrl = getRendererDevServerUrl();
    const url = devUrl.endsWith('/') ? devUrl : `${devUrl}/`;
    settingsWindow.loadURL(`${url}#settings`);
  } else {
    settingsWindow.loadFile(getRendererProdHtmlPath(), {
      hash: 'settings',
    });
  }

  maybeOpenDevTools(
    settingsWindow.webContents,
    {
      isPackaged: app.isPackaged,
      autoOpenEnv: process.env.IKI_AUTO_OPEN_DEVTOOLS,
    },
    { mode: 'detach' }
  );
  return settingsWindow;
};
