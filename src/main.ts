import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { getConfig, setConfig, migrateFromJson } from './core/db/database';
import * as providerDb from './core/db/providers';
import * as chatThreadDb from './core/db/chat_thread';
import * as chatMessageDb from './core/db/chat_message';
import * as workspaceDb from './core/db/workspaces';
import * as promptAppDb from './core/db/prompt_apps';
import { getToolModel } from './core/provider/tool_model';

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

const saveConfig = (config: any) => {
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

// Chat Thread Management
ipcMain.handle('chat:threads:list', () => chatThreadDb.getChatThreads());
ipcMain.handle('chat:threads:get', (_, id) => chatThreadDb.getChatThread(id));
ipcMain.handle('chat:threads:create', (_, thread) => {
  const threadId = thread.id || `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const title = thread.title || 'New Chat';
  chatThreadDb.addChatThread({
    id: threadId,
    title,
    model: thread.model || null,
    metadata: thread.metadata || '{}',
    is_generating: false,
  });
  // Return the created thread
  return chatThreadDb.getChatThread(threadId);
});
ipcMain.handle('chat:threads:update', (_, id, thread) => chatThreadDb.updateChatThread(id, thread));
ipcMain.handle('chat:threads:delete', (_, id) => chatThreadDb.deleteChatThread(id));

// Chat Message Management
ipcMain.handle('chat:messages:list', (_, threadId) => chatMessageDb.getChatMessages(threadId));
ipcMain.handle('chat:messages:get', (_, id) => chatMessageDb.getChatMessage(id));
ipcMain.handle('chat:messages:create', (_, message) => {
  const messageId = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = message.timestamp || new Date().toISOString();
  chatMessageDb.addChatMessage({
    id: messageId,
    thread_id: message.thread_id,
    parent_id: message.parent_id || null,
    slot_id: message.slot_id || null,
    depth: message.depth || 0,
    message: message.message,
    timestamp,
    metadata: message.metadata || '{}',
  });
  // Return the created message
  return chatMessageDb.getChatMessage(messageId);
});
ipcMain.handle('chat:messages:update', (_, id, message) =>
  chatMessageDb.updateChatMessage(id, message)
);
ipcMain.handle('chat:messages:delete', (_, id) => chatMessageDb.deleteChatMessage(id));

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
  return getToolModel();
});

// Chat/LLM Integration
import * as llmFactory from './core/provider/llm/factory';
import * as deepseekProvider from './core/provider/llm/deepseek';
import * as openaiProvider from './core/provider/llm/openai';
import * as kimiProvider from './core/provider/llm/kimi';

// Get available models for a provider type
ipcMain.handle('chat:getModels', async (_, providerType: string) => {
  // 1. Try provider-specific cache if it exists (e.g. for DeepSeek special logic)
  if (providerType === 'deepseek') return await deepseekProvider.getDeepSeekModels();
  if (providerType === 'openai') return await openaiProvider.getOpenAIModels();
  if (providerType === 'kimi') return await kimiProvider.getKimiModels();

  // 2. Fallback to general factory fetch
  return await llmFactory.fetchModelsFromDev(providerType);
});

// Check if a provider is configured
ipcMain.handle('chat:isProviderConfigured', (_, providerType: string) => {
  try {
    const config = llmFactory.getProviderConfig(providerType);
    return !!config.apiKey;
  } catch {
    return false;
  }
});

// Send a chat message (non-streaming)
ipcMain.handle(
  'chat:send',
  async (
    _,
    options: {
      providerType: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
    }
  ) => {
    try {
      const text = await llmFactory.generateChat({
        providerType: options.providerType,
        modelId: options.model,
        messages: options.messages,
      });
      return { success: true, text };
    } catch (error: any) {
      return { success: false, error: error.message || 'Unknown error' };
    }
  }
);

// Stream a chat response
ipcMain.handle(
  'chat:stream',
  async (
    event,
    options: {
      providerType: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
    }
  ) => {
    const webContents = event.sender;

    try {
      const result = await llmFactory.streamChat(
        {
          providerType: options.providerType,
          modelId: options.model,
          messages: options.messages,
        },
        chunk => {
          webContents.send('chat:chunk', chunk);
        }
      );
      webContents.send('chat:done', result);
      return { success: true };
    } catch (error: any) {
      webContents.send('chat:error', error.message);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }
);

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
      preload: path.join(__dirname, 'index.js'),
      nodeIntegration: false,
      devTools: true,
    },
  });

  const MAIN_WINDOW_VITE_DEV_SERVER_URL =
    process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || 'http://localhost:5173';

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = MAIN_WINDOW_VITE_DEV_SERVER_URL.endsWith('/')
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/`;
    settingsWindow.loadURL(`${url}#settings`);
  } else {
    settingsWindow.loadFile(path.join(__dirname, `../index.html`), { hash: 'settings' });
  }
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
      preload: path.join(__dirname, 'index.js'),
      nodeIntegration: false,
    },
    // ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
  });

  // and load the index.html of the app.
  const MAIN_WINDOW_VITE_DEV_SERVER_URL =
    process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || 'http://localhost:5173';

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../index.html`));
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
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
