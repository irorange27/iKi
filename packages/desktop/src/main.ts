import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { getAppConfig } from '@iki/harness/config';
import { initializeDatabase } from '@iki/store/database';
import {
  applyAppLoggingConfig,
  createLogger,
  setBaseLogContext,
  setConsoleLoggingEnabled,
} from '@iki/core/logger';
import { registerStandardTools } from '@iki/harness/tools';
import { getMcpManager } from '@iki/harness/mcp';
import { setHostFetch, setPlatformInfo } from '@iki/core/platform';
import { electronFetchWithTimeout } from './main/services/network/electron_fetch';
import { registerMainIpc } from './main/ipc';
import {
  startBackgroundRuntime,
  stopBackgroundRuntime,
} from './main/services/runtime/background_runtime';
import { startAppUpdateService } from './main/services/update/auto_update_service';
import { companionService } from './main/services/companion/companion_service';
import { createMainWindow } from './main/windows/main_window';
import { installApplicationMenu } from './main/windows/app_menu';
import { setDevDockIcon } from './main/windows/dev_dock_icon';
import { syncCompanionWindowToConfig } from './main/windows/companion_window';

const appLogger = createLogger({ module: 'app' });

setBaseLogContext({ process: 'main' });
setConsoleLoggingEnabled(false);

wirePlatformContext();
setHostFetch(electronFetchWithTimeout);

const syncLoggingConfig = () => {
  try {
    applyAppLoggingConfig(getAppConfig());
  } catch {
    /* empty: error is not actionable here */
  }
};

const updatePlatformTheme = () => {
  setPlatformInfo({
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  });
};

const updatePlatformDisplayScale = () => {
  try {
    const scale = screen.getPrimaryDisplay().scaleFactor;
    setPlatformInfo({ displayScale: scale });
  } catch {
    /* empty: error is not actionable here */
  }
};

const hasExplicitUserDataDir = process.argv.some(arg => arg.startsWith('--user-data-dir='));
setPlatformInfo({
  ...(hasExplicitUserDataDir ? { userDataPath: app.getPath('userData') } : {}),
  locale: app.getLocale(),
});
initializeDatabase();
syncLoggingConfig();
appLogger.event({
  level: 'info',
  event: 'app.start',
  message: 'Desktop process booting',
  data: {
    packaged: app.isPackaged,
    platform: process.platform,
  },
});

if (app.isReady()) {
  updatePlatformTheme();
  updatePlatformDisplayScale();
} else {
  app.on('ready', () => {
    updatePlatformTheme();
    updatePlatformDisplayScale();
  });
}

nativeTheme.on('updated', () => {
  updatePlatformTheme();
});

registerStandardTools();
void getMcpManager().initialize();
registerMainIpc();

if (process.platform === 'win32' && process.argv.some(arg => arg.startsWith('--squirrel-'))) {
  app.quit();
}

app.on('ready', () => {
  syncLoggingConfig();
  appLogger.event({
    level: 'info',
    event: 'app.ready',
    message: 'Application ready',
    data: {
      packaged: app.isPackaged,
      platform: process.platform,
    },
  });
  installApplicationMenu();
  startBackgroundRuntime();
  startAppUpdateService(getAppConfig());
  setDevDockIcon();
  createMainWindow();
  syncCompanionWindowToConfig(getAppConfig());
  companionService.refreshAvailability();
});

app.on('before-quit', () => {
  appLogger.event({
    level: 'info',
    event: 'app.shutdown',
    message: 'Application shutting down',
  });
  stopBackgroundRuntime();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    syncCompanionWindowToConfig(getAppConfig());
    companionService.refreshAvailability();
  }
});
