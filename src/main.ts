import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import started from 'electron-squirrel-startup';
import { registerStandardTools } from './core/tools';
import { getMcpManager } from './core/mcp';
import { setPlatformInfo } from './core/platform';
import { registerMainIpc } from './main/ipc';
import { startProactiveTaskScheduler } from './main/services/tasks/proactive_tasks';
import { createMainWindow } from './main/windows/main_window';

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
    // ignore
  }
};

setPlatformInfo({
  userDataPath: app.getPath('userData'),
  locale: app.getLocale(),
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

// Register standard tools + IPC handlers on startup.
registerStandardTools();
void getMcpManager().initialize();
registerMainIpc();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  startProactiveTaskScheduler();
  createMainWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
