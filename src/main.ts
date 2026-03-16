import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import started from 'electron-squirrel-startup';
import { getConfig, setConfig, migrateFromJson } from './core/db/database';
import * as providerDb from './core/db/providers';
import * as memoryDb from './core/db/memory';
import * as workspaceDb from './core/db/workspaces';
import * as promptAppDb from './core/db/prompt_apps';
import { getToolModel, generateTitleWithAgent } from './core/provider/tool_model';
import { registerStandardTools, defaultToolRegistry } from './core/tools';
import {
  getSkillFolderPath,
  getSkillRootsForUi,
  listSkills,
  readSkillContent,
} from './core/skills';
import { registerChatIpc } from './main/ipc/chat';
import { getErrorMessage } from './main/utils/errors';

const getRendererDevServerUrl = () => process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || 'http://localhost:5173';

const getRendererProdHtmlPath = () => path.join(__dirname, '../renderer/main_window/index.html');

// Register standard tools on startup
registerStandardTools();
registerChatIpc();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Config Management
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'app-config.json');

// Run migration if old config exists
migrateFromJson(configPath, 'app_config');

const loadConfig = () => {
  return getConfig('app_config') || {};
};

const saveConfig = (config: unknown) => {
  setConfig('app_config', config);
};

ipcMain.handle('config:get', () => {
  return loadConfig();
});

ipcMain.handle('config:set', (event, config) => {
  saveConfig(config);

  const windows = BrowserWindow.getAllWindows();

  windows.forEach(win => {
    win.webContents.send('config:updated', config);
  });
  return true;
});

// Provider Management
ipcMain.handle('providers:list', () => {
  const providers = providerDb.getProviders();
  console.log('[Main] providers:list returned:', providers.length, 'providers');
  return providers;
});
ipcMain.handle('providers:get', (_, id) => providerDb.getProvider(id));
ipcMain.handle('providers:add', (_, provider) => {
  console.log('[Main] providers:add called with:', provider);
  try {
    const result = providerDb.addProvider(provider);
    console.log('[Main] providers:add result:', result);
    return result;
  } catch (error) {
    console.error('[Main] providers:add error:', error);
    throw error;
  }
});
ipcMain.handle('providers:update', (_, id, provider) => {
  console.log('[Main] providers:update called with id:', id, 'data:', provider);
  try {
    const result = providerDb.updateProvider(id, provider);
    console.log('[Main] providers:update result:', result);
    return result;
  } catch (error) {
    console.error('[Main] providers:update error:', error);
    throw error;
  }
});
ipcMain.handle('providers:delete', (_, id) => providerDb.deleteProvider(id));

// Memory Management
ipcMain.handle('memory:short:list', (_, threadId, limit) =>
  memoryDb.listShortMemory(threadId, limit)
);
ipcMain.handle('memory:short:add', (_, entry) => memoryDb.addShortMemory(entry));
ipcMain.handle('memory:long:add', (_, entry) => memoryDb.addLongMemory(entry));
ipcMain.handle('memory:long:list', (_, threadId, limit) =>
  memoryDb.listLongMemory(threadId, limit)
);
ipcMain.handle('memory:long:search', (_, threadId, query, options) =>
  memoryDb.searchLongMemory(threadId, query, options)
);

// Workspace Management
ipcMain.handle('workspaces:list', () => workspaceDb.getWorkspaces());
ipcMain.handle('workspaces:get', (_, id) => workspaceDb.getWorkspace(id));
ipcMain.handle('workspaces:getByPath', (_, path) => workspaceDb.getWorkspaceByPath(path));
ipcMain.handle('workspaces:getVisible', () => workspaceDb.getVisibleWorkspaces());
ipcMain.handle('workspaces:create', (_, workspace) => {
  const workspaceId =
    workspace.id || `workspace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  workspaceDb.addWorkspace({
    id: workspaceId,
    path: workspace.path,
    name: workspace.name,
    is_temporary: workspace.is_temporary || 0,
    show_in_list: workspace.show_in_list !== undefined ? workspace.show_in_list : 1,
  });
  // Return the created workspace
  return workspaceDb.getWorkspace(workspaceId);
});
ipcMain.handle('workspaces:update', (_, id, workspace) =>
  workspaceDb.updateWorkspace(id, workspace)
);
ipcMain.handle('workspaces:delete', (_, id) => workspaceDb.deleteWorkspace(id));
ipcMain.handle('workspaces:toggleVisibility', (_, id) => workspaceDb.toggleWorkspaceVisibility(id));

// Prompt App Management
ipcMain.handle('promptApps:list', () => promptAppDb.getPromptApps());
ipcMain.handle('promptApps:get', (_, id) => promptAppDb.getPromptApp(id));
ipcMain.handle('promptApps:getEnabled', () => promptAppDb.getEnabledPromptApps());
ipcMain.handle('promptApps:create', (_, app) => {
  const appId = app.id || `promptApp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  promptAppDb.addPromptApp({
    id: appId,
    name: app.name,
    description: app.description || null,
    icon: app.icon || null,
    prompt_template: app.prompt_template,
    placeholders: app.placeholders || '[]',
    model: app.model || null,
    enabled: app.enabled !== undefined ? app.enabled : 1,
    sort_order: app.sort_order || 0,
    tools: app.tools || null,
    reasoning_effort: app.reasoning_effort || null,
    expects_image_result: app.expects_image_result || 0,
    is_incognito: app.is_incognito || 0,
    shortcut: app.shortcut || null,
    window_width: app.window_width || null,
    window_height: app.window_height || null,
    font_size: app.font_size || null,
  });
  // Return the created app
  return promptAppDb.getPromptApp(appId);
});
ipcMain.handle('promptApps:update', (_, id, app) => promptAppDb.updatePromptApp(id, app));
ipcMain.handle('promptApps:delete', (_, id) => promptAppDb.deletePromptApp(id));
ipcMain.handle('promptApps:toggleEnabled', (_, id) => promptAppDb.togglePromptAppEnabled(id));
ipcMain.handle('promptApps:updateSortOrder', (_, id, sortOrder) =>
  promptAppDb.updatePromptAppSortOrder(id, sortOrder)
);

// Tool Model Management
ipcMain.handle('toolModel:get', () => {
  try {
    return getToolModel();
  } catch (error: unknown) {
    console.error('Failed to get tool model:', error);
    return null;
  }
});

ipcMain.handle('tools:list', () => {
  try {
    return defaultToolRegistry.getToolMetadata();
  } catch (error: unknown) {
    console.error('Failed to list tools:', error);
    return [];
  }
});

ipcMain.handle('skills:list', async () => {
  try {
    return await listSkills({ forceRefresh: true });
  } catch (error: unknown) {
    console.error('Failed to list skills:', error);
    return [];
  }
});

ipcMain.handle('skills:roots', () => {
  try {
    return getSkillRootsForUi();
  } catch (error: unknown) {
    console.error('Failed to get skill roots:', error);
    return [];
  }
});

ipcMain.handle('skills:open-root', async (_, source?: string) => {
  try {
    const roots = getSkillRootsForUi();
    const normalizedSource = source === 'codex' ? 'codex' : 'user';
    const target = roots.find(r => r.source === normalizedSource) || roots[0];
    if (!target?.path) {
      return { success: false, error: 'No skills folder configured' };
    }

    await fs.mkdir(target.path, { recursive: true });
    const errorText = await shell.openPath(target.path);
    if (errorText) {
      return { success: false, error: errorText, path: target.path };
    }
    return { success: true, path: target.path };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
});

ipcMain.handle('skills:open-skill', async (_, id: string) => {
  try {
    const folderPath = await getSkillFolderPath(id);
    if (!folderPath) {
      return { success: false, error: 'Skill not found' };
    }
    const errorText = await shell.openPath(folderPath);
    if (errorText) {
      return { success: false, error: errorText, path: folderPath };
    }
    return { success: true, path: folderPath };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
});

ipcMain.handle('skills:read', async (_, id: string, options?: { maxChars?: number }) => {
  try {
    const content = await readSkillContent(id, { maxChars: options?.maxChars });
    if (!content) {
      return { success: false, error: 'Skill not found' };
    }
    return { success: true, ...content };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
});

ipcMain.handle('toolModel:generateTitle', async (_, conversationContent: string) => {
  try {
    return await generateTitleWithAgent(conversationContent);
  } catch (error: unknown) {
    console.error('Failed to generate title with agent:', error);
    return null;
  }
});

ipcMain.on('open-settings', () => {
  const settingsWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    vibrancy: 'sidebar',
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

  settingsWindow.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.on('close-window', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    // macOS
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    vibrancy: 'sidebar',

    webPreferences: {
      preload: path.join(__dirname, './index.js'),
      nodeIntegration: false,
    },
    // ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
  });

  // and load the index.html of the app.
  if (!app.isPackaged) {
    mainWindow.loadURL(getRendererDevServerUrl());
  } else {
    const indexPath = getRendererProdHtmlPath();
    mainWindow.loadFile(indexPath);
    console.log('Loaded index.html from file', indexPath);
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

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
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
