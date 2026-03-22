import { BrowserWindow, app } from 'electron';
import path from 'node:path';

import { maybeOpenDevTools } from './devtools_policy';
import { loadRendererEntry } from './renderer';
import { resolveWindowBootstrapBackgroundColor } from './theme_bootstrap';

export const createSettingsWindow = (): BrowserWindow => {
  const settingsWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: resolveWindowBootstrapBackgroundColor(),
    // Start shadow-free until the renderer resolves the active theme and opts in for light mode.
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

  void loadRendererEntry(settingsWindow, {
    isPackaged: app.isPackaged,
    hash: 'settings',
  });

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
