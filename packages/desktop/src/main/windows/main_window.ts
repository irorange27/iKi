import { BrowserWindow, app } from 'electron';
import path from 'node:path';

import { createLogger } from '@iki/backend/logger';
import { maybeOpenDevTools } from './devtools_policy';
import { loadRendererEntry } from './renderer';
import { attachViewportResyncGuard } from './viewport_resync';
import { resolveWindowBootstrapBackgroundColor } from './theme_bootstrap';

const windowLogger = createLogger({ module: 'main_window' });

let mainWindowRef: BrowserWindow | null = null;

export const getMainWindow = (): BrowserWindow | null => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    mainWindowRef = null;
    return null;
  }
  return mainWindowRef;
};

export const createMainWindow = (): BrowserWindow => {
  const existingWindow = getMainWindow();
  if (existingWindow) {
    return existingWindow;
  }

  const mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 480,
    minHeight: 640,
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

  mainWindowRef = mainWindow;

  attachViewportResyncGuard(mainWindow);

  if (process.platform === 'darwin') {
    // The traffic lights are drawn by the renderer (TrafficLights.vue): macOS
    // 15 greys the native buttons out to near-invisible on the light sidebar
    // when the window is not focused, and they cannot be recolored natively.
    mainWindow.setWindowButtonVisibility(false);
    mainWindow.on('enter-full-screen', () => {
      mainWindow.webContents.send('window:fullscreen-changed', true);
    });
    mainWindow.on('leave-full-screen', () => {
      mainWindow.webContents.send('window:fullscreen-changed', false);
    });
    const sendFocusChanged = () => {
      mainWindow.webContents.send('window:focus-changed', mainWindow.isFocused());
    };
    mainWindow.on('focus', sendFocusChanged);
    mainWindow.on('blur', sendFocusChanged);
  }

  void loadRendererEntry(mainWindow, { isPackaged: app.isPackaged });

  maybeOpenDevTools(mainWindow.webContents, {
    isPackaged: app.isPackaged,
    autoOpenEnv: process.env.IKI_AUTO_OPEN_DEVTOOLS,
  });

  mainWindow.webContents.on('console-message', details => {
    const consoleLevel =
      details.level === 'error'
        ? 'error'
        : details.level === 'warning'
          ? 'warn'
          : 'info';

    windowLogger.event({
      level: consoleLevel,
      event: 'window.console',
      message: 'Renderer emitted a console message',
      data: {
        window_kind: 'main',
        console_level: details.level,
        console_message: details.message,
        source_id: details.sourceId || null,
        line: typeof details.lineNumber === 'number' ? details.lineNumber : null,
      },
    });
  });

  mainWindow.webContents.on(
    'render-process-gone',
    (_event, details: { reason: string; exitCode: number }) => {
      windowLogger.event({
        level: 'error',
        event: 'window.render_process_gone',
        outcome: 'failed',
        message: 'Renderer process exited unexpectedly',
        data: {
          window_kind: 'main',
          reason: details.reason,
          exit_code: details.exitCode,
        },
      });
    }
  );

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      windowLogger.event({
        level: 'error',
        event: 'window.load_failed',
        outcome: 'failed',
        message: 'Main window failed to load renderer content',
        data: {
          window_kind: 'main',
          error_code: errorCode,
          error_description: errorDescription,
          validated_url: validatedURL,
          is_main_frame: isMainFrame,
        },
      });
    }
  );

  windowLogger.event({
    level: 'info',
    event: 'window.created',
    message: 'Main window created',
    data: {
      window_kind: 'main',
    },
  });

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
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

export const showMainWindow = (): BrowserWindow => {
  const mainWindow = getMainWindow() ?? createMainWindow();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  return mainWindow;
};
