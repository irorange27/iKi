import { BrowserWindow, app, screen } from 'electron';
import path from 'node:path';

import { getAppConfig, setAppConfig } from '../../core/config';
import { createLogger } from '../../core/logger';
import type { AppConfig } from '../../shared/types/config';
import { maybeOpenDevTools } from './devtools_policy';
import { loadRendererEntry } from './renderer';

const companionLogger = createLogger({ module: 'companion_window' });

const COMPANION_WIDTH = 272;
const COMPANION_HEIGHT = 176;
const COMPANION_MARGIN = 24;
const MIN_VISIBLE_PIXELS = 56;

let companionWindowRef: BrowserWindow | null = null;
let persistPositionTimer: NodeJS.Timeout | null = null;

const getCompanionConfig = (config: AppConfig = getAppConfig()) => config.ui.companion;

const getCompanionWindow = (): BrowserWindow | null => {
  if (!companionWindowRef || companionWindowRef.isDestroyed()) {
    companionWindowRef = null;
    return null;
  }
  return companionWindowRef;
};

const intersectsVisibleArea = (
  bounds: Electron.Rectangle,
  workArea: Electron.Rectangle
): boolean => {
  const visibleWidth =
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
  const visibleHeight =
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
    Math.max(bounds.y, workArea.y);
  return visibleWidth >= MIN_VISIBLE_PIXELS && visibleHeight >= MIN_VISIBLE_PIXELS;
};

const resolveDefaultBounds = (): Electron.Rectangle => {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  return {
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
    x: Math.round(workArea.x + workArea.width - COMPANION_WIDTH - COMPANION_MARGIN),
    y: Math.round(workArea.y + workArea.height - COMPANION_HEIGHT - COMPANION_MARGIN),
  };
};

const resolveInitialBounds = (config: AppConfig): Electron.Rectangle => {
  const fallback = resolveDefaultBounds();
  const { rememberPosition, position } = getCompanionConfig(config);
  if (!rememberPosition) return fallback;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return fallback;

  const candidate: Electron.Rectangle = {
    x: Math.trunc(position.x ?? fallback.x),
    y: Math.trunc(position.y ?? fallback.y),
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
  };
  const displays = screen.getAllDisplays();
  if (displays.some(display => intersectsVisibleArea(candidate, display.workArea))) {
    return candidate;
  }
  return fallback;
};

const persistCompanionPosition = (win: BrowserWindow) => {
  const config = getAppConfig();
  if (!getCompanionConfig(config).rememberPosition) return;
  const bounds = win.getBounds();
  const nextConfig: AppConfig = {
    ...config,
    ui: {
      ...config.ui,
      companion: {
        ...config.ui.companion,
        position: {
          x: bounds.x,
          y: bounds.y,
        },
      },
    },
  };
  setAppConfig(nextConfig);
};

const attachPositionPersistence = (win: BrowserWindow) => {
  win.on('move', () => {
    if (persistPositionTimer) {
      clearTimeout(persistPositionTimer);
    }
    persistPositionTimer = setTimeout(() => {
      persistPositionTimer = null;
      if (!win.isDestroyed()) {
        persistCompanionPosition(win);
      }
    }, 180);
  });
};

const applyWindowOptions = (win: BrowserWindow, config: AppConfig) => {
  const companionConfig = getCompanionConfig(config);
  win.setAlwaysOnTop(companionConfig.alwaysOnTop, 'floating');
  if (typeof win.setVisibleOnAllWorkspaces === 'function') {
    win.setVisibleOnAllWorkspaces(companionConfig.alwaysOnTop, {
      visibleOnFullScreen: companionConfig.alwaysOnTop,
    });
  }
};

export const createCompanionWindow = (config: AppConfig = getAppConfig()): BrowserWindow => {
  const existing = getCompanionWindow();
  if (existing) {
    applyWindowOptions(existing, config);
    return existing;
  }

  const bounds = resolveInitialBounds(config);
  const companionWindow = new BrowserWindow({
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
    x: bounds.x,
    y: bounds.y,
    minWidth: COMPANION_WIDTH,
    minHeight: COMPANION_HEIGHT,
    maxWidth: COMPANION_WIDTH,
    maxHeight: COMPANION_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'iKi Companion',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, './index.js'),
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  companionWindowRef = companionWindow;
  applyWindowOptions(companionWindow, config);
  attachPositionPersistence(companionWindow);

  void loadRendererEntry(companionWindow, {
    isPackaged: app.isPackaged,
    hash: 'companion',
  });

  maybeOpenDevTools(
    companionWindow.webContents,
    {
      isPackaged: app.isPackaged,
      autoOpenEnv: process.env.IKI_AUTO_OPEN_DEVTOOLS,
    },
    { mode: 'detach' }
  );

  companionWindow.once('ready-to-show', () => {
    if (typeof companionWindow.showInactive === 'function') {
      companionWindow.showInactive();
    } else {
      companionWindow.show();
    }
  });

  companionLogger.event({
    level: 'info',
    event: 'window.created',
    message: 'Companion window created',
    data: {
      window_kind: 'companion',
    },
  });

  companionWindow.on('closed', () => {
    if (companionWindowRef === companionWindow) {
      companionWindowRef = null;
    }
    companionLogger.event({
      level: 'info',
      event: 'window.closed',
      message: 'Companion window closed',
      data: {
        window_kind: 'companion',
      },
    });
  });

  return companionWindow;
};

export const closeCompanionWindow = (): void => {
  const win = getCompanionWindow();
  if (!win) return;
  win.close();
};

export const syncCompanionWindowToConfig = (config: AppConfig = getAppConfig()): void => {
  const companionConfig = getCompanionConfig(config);
  if (!companionConfig.enabled) {
    closeCompanionWindow();
    return;
  }
  const win = createCompanionWindow(config);
  applyWindowOptions(win, config);
};

export { getCompanionWindow };
