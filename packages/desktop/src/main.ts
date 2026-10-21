import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import started from 'electron-squirrel-startup';
import { wirePlatformContext } from '@iki/backend/platform_wiring';
import { getAppConfig } from '@iki/backend/config';
import {
  applyAppLoggingConfig,
  createLogger,
  setBaseLogContext,
  setConsoleLoggingEnabled,
} from '@iki/backend/logger';
import { registerStandardTools } from '@iki/backend/tools';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getMcpManager } from '@iki/backend/mcp';
import { initLangfuseTracing, shutdownLangfuseTracing } from '@iki/backend/observability/langfuse';
import { setHostFetch, setPlatformInfo } from '@iki/backend/platform';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import {
  finalizeHarnessTurn,
  finalizeTurnFailure,
} from '@iki/backend/thread_session/turn_driver';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { resolveElement } from './main/services/devtools/element_source';
import { startDaemonServer } from '@iki/daemon/server';
import { electronFetchWithTimeout } from './main/services/network/electron_fetch';
import { registerMainIpc } from './main/ipc';
import {
  DAEMON_MODE_ARG,
  startDesktopDaemon,
  stopDesktopDaemon,
} from './main/services/daemon/daemon_lifecycle';
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

const isDaemonMode = process.argv.includes(DAEMON_MODE_ARG);
const appLogger = createLogger({ module: 'app' });

setBaseLogContext({ process: isDaemonMode ? 'daemon' : 'main' });

if (!isDaemonMode) {
  setConsoleLoggingEnabled(false);
}

wirePlatformContext();
setHostFetch(electronFetchWithTimeout);
initLangfuseTracing();

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

if (isDaemonMode) {
  const portEnv = Number(process.env.IKI_DAEMON_PORT || '');
  const port = Number.isFinite(portEnv) && portEnv > 0 ? portEnv : undefined;
  const host = process.env.IKI_DAEMON_HOST?.trim() || undefined;

  appLogger.event({
    level: 'info',
    event: 'app.start',
    message: 'Daemon process booting',
    data: {
      daemon_mode: true,
      host: host || null,
      port: port || null,
    },
  });
  const daemonServer = startDaemonServer({ port, host });
  startBackgroundRuntime();
  void daemonServer.ready.catch(error => {
    appLogger.event({
      level: 'error',
      event: 'app.start',
      outcome: 'failed',
      error,
      message: 'Daemon process failed during startup.',
      data: {
        daemon_mode: true,
        host: host || null,
        port: port || null,
      },
    });
    stopBackgroundRuntime();
    process.exitCode = 1;
  });
} else {
  setPlatformInfo({
    userDataPath: app.getPath('userData'),
    locale: app.getLocale(),
  });
  syncLoggingConfig();
  appLogger.event({
    level: 'info',
    event: 'app.start',
    message: 'Desktop process booting',
    data: {
      daemon_mode: false,
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

  registerStandardTools({
    elementSourceResolver: request => resolveElement(request),
    delegatedAgentRuntime: {
      createRunTracker: createAgentRunTracker,
      getConversationToolModel: getToolModel,
      createHarness: startPiTurnHarness,
      finalize: {
        finalizeFailure: finalizeTurnFailure,
        finalizeSuccess: finalizeHarnessTurn,
      },
    },
  });
  void getMcpManager().initialize();
  registerMainIpc();

  if (started) {
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
    void startDesktopDaemon();
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
    stopDesktopDaemon();
    void shutdownLangfuseTracing();
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
}
