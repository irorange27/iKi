import { BrowserWindow, Menu, app } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import {
  DEVTOOLS_TOGGLE_ACCELERATOR,
  DEVTOOLS_TOGGLE_ACCELERATOR_ALT,
  createDevToolsToggleAction,
  parseBooleanEnv,
} from './devtools_policy';
import { restartApp, shouldOfferRestart } from './app_restart';

export const RESTART_ACCELERATOR = 'CommandOrControl+Alt+R';

export const DEVTOOLS_MENU_ENV = 'IKI_DEVTOOLS_MENU';

export const shouldInstallDevToolsMenu = (
  env: string | undefined = process.env[DEVTOOLS_MENU_ENV]
): boolean => parseBooleanEnv(env) ?? true;

export const resolveDevToolsTargetWindow = (): BrowserWindow | null => {
  const focused =
    typeof BrowserWindow.getFocusedWindow === 'function' ? BrowserWindow.getFocusedWindow() : null;
  if (focused && !focused.isDestroyed()) return focused;
  const windows =
    typeof BrowserWindow.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : [];
  return windows.find(win => !win.isDestroyed()) ?? null;
};

export const buildViewMenuTemplate = (options: {
  isPackaged: boolean;
}): MenuItemConstructorOptions[] => {
  const devToolsToggle = createDevToolsToggleAction(
    () => resolveDevToolsTargetWindow()?.webContents ?? null
  );

  return [
    {
      label: 'Reload',
      accelerator: 'CommandOrControl+R',
      click: () => {
        const win = resolveDevToolsTargetWindow();
        if (win && !win.webContents.isDestroyed()) win.webContents.reload();
      },
    },
    {
      label: 'Force Reload',
      accelerator: 'CommandOrControl+Shift+R',
      click: () => {
        const win = resolveDevToolsTargetWindow();
        if (win && !win.webContents.isDestroyed()) win.webContents.reloadIgnoringCache();
      },
    },
    { type: 'separator' },
    {
      id: 'toggle-devtools',
      label: 'Toggle Developer Tools',
      accelerator: DEVTOOLS_TOGGLE_ACCELERATOR,
      acceleratorWorksWhenHidden: true,
      click: () => {
        devToolsToggle();
      },
    },
    {
      id: 'toggle-devtools-alt',
      label: 'Toggle Developer Tools',
      accelerator: DEVTOOLS_TOGGLE_ACCELERATOR_ALT,
      acceleratorWorksWhenHidden: true,
      visible: false,
      click: () => {
        devToolsToggle();
      },
    },
    { type: 'separator' },
    ...(shouldOfferRestart(options)
      ? [
          {
            id: 'restart-app',
            label: 'Restart (main-process changes)',
            accelerator: RESTART_ACCELERATOR,
            acceleratorWorksWhenHidden: true,
            click: () => {
              restartApp();
            },
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Toggle Full Screen',
      accelerator: process.platform === 'darwin' ? 'Control+Command+F' : 'F11',
      click: () => {
        const win = resolveDevToolsTargetWindow();
        if (win) win.setFullScreen(!win.isFullScreen());
      },
    },
  ];
};

export const installApplicationMenu = (): void => {
  if (!shouldInstallDevToolsMenu()) {
    return;
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: buildViewMenuTemplate({ isPackaged: app.isPackaged }),
  };

  const template: MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          {
            label: 'Edit',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' },
            ],
          },
          viewMenu,
          {
            label: 'Window',
            submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
          },
        ]
      : [
          {
            label: 'File',
            submenu: [{ role: 'quit' }],
          },
          {
            label: 'Edit',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' },
            ],
          },
          viewMenu,
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
