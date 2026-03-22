import { BrowserWindow, app } from 'electron';
import path from 'node:path';

import { createLogger } from '../../core/logger';
import { maybeOpenDevTools } from './devtools_policy';
import { loadRendererEntry } from './renderer';
import { resolveWindowBootstrapBackgroundColor } from './theme_bootstrap';

const windowLogger = createLogger({ module: 'main_window' });

export const createMainWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: resolveWindowBootstrapBackgroundColor(),
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

  windowLogger.event({
    level: 'info',
    event: 'window.created',
    message: 'Main window created',
    data: {
      window_kind: 'main',
    },
  });

  mainWindow.on('closed', () => {
    windowLogger.event({
      level: 'info',
      event: 'window.closed',
      message: 'Main window closed',
      data: {
        window_kind: 'main',
      },
    });
  });

  return mainWindow;
};
