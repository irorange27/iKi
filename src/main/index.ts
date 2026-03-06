import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { getConfig, setConfig, migrateFromJson } from '../core/db/database';
import * as providerDb from '../core/db/providers';
import * as chatThreadDb from '../core/db/chat_thread';
import * as chatMessageDb from '../core/db/chat_message';
import * as workspaceDb from '../core/db/workspaces';
import * as promptAppDb from '../core/db/prompt_apps';
import { getToolModel, generateTitleWithAgent } from '../core/provider/tool_model';
import { registerStandardTools, defaultToolRegistry } from '../core/tools';
import { SimpleAgent } from '../core/agent';
import type { AgentResult } from '../core/agent';

const getRendererDevServerUrl = () =>
  process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || 'http://localhost:5173';

const getRendererProdHtmlPath = () => path.join(__dirname, '../renderer/main_window/index.html');

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

type ChatInputMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
};

type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const toLlmChatMessages = (messages: ChatInputMessage[]): LlmChatMessage[] =>
  messages.filter(
    (message): message is LlmChatMessage =>
      message.role === 'system' || message.role === 'user' || message.role === 'assistant'
  );

// Register standard tools on startup
registerStandardTools();

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

ipcMain.handle('toolModel:generateTitle', async (_, conversationContent: string) => {
  try {
    return await generateTitleWithAgent(conversationContent);
  } catch (error: unknown) {
    console.error('Failed to generate title with agent:', error);
    return null;
  }
});

// Chat/LLM Integration
import * as llmFactory from '../core/provider/llm/factory';
import * as deepseekProvider from '../core/provider/llm/deepseek';
import * as openaiProvider from '../core/provider/llm/openai';
import * as kimiProvider from '../core/provider/llm/kimi';

// Get available models for a provider type
ipcMain.handle('chat:getModels', async (_, providerType: string) => {
  try {
    // 1. Try provider-specific cache if it exists (e.g. for DeepSeek special logic)
    if (providerType === 'deepseek') return await deepseekProvider.getDeepSeekModels();
    if (providerType === 'openai') return await openaiProvider.getOpenAIModels();
    if (providerType === 'kimi') return await kimiProvider.getKimiModels();

    // 2. Fallback to general factory fetch
    return await llmFactory.fetchModelsFromDev(providerType);
  } catch (error: unknown) {
    console.error(`Failed to get models for ${providerType}:`, error);
    return [];
  }
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
      messages: ChatInputMessage[];
      tools?: string[]; // Optional specific tools to enable
    }
  ) => {
    try {
      if (options.tools && options.tools.length > 0) {
        // Use Agent if tools are specified
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: '', // Persona is already integrated in SimpleAgent
          enableTools: true,
          maxIterations: 5,
        });

        // Register selected tools
        for (const toolName of options.tools) {
          const tool = defaultToolRegistry.get(toolName);
          if (tool) agent.registerTool(tool);
        }

        // Separate user prompt from history
        const history = options.messages.slice(0, -1);
        const lastMessage = options.messages[options.messages.length - 1];

        agent.setMessages(history);
        const result = await agent.generate(lastMessage.content);
        return { success: true, text: result.response };
      } else {
        // Fallback to simple LLM call
        const text = await llmFactory.generateChat({
          providerType: options.providerType,
          modelId: options.model,
          messages: toLlmChatMessages(options.messages),
        });
        return { success: true, text };
      }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
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
      messages: ChatInputMessage[];
      tools?: string[];
    }
  ) => {
    const webContents = event.sender;
    try {
      if (options.tools && options.tools.length > 0) {
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: '',
          enableTools: true,
          maxIterations: 5,
        });

        for (const toolName of options.tools) {
          const tool = defaultToolRegistry.get(toolName);
          console.log(`[Main] Registering tool: ${toolName}`, tool ? 'found' : 'not found');
          if (tool) {
            agent.registerTool(tool);
          } else {
            console.warn(`[Main] Tool ${toolName} not found in registry`);
          }
        }

        console.log('[Main] Registered tools count:', agent.getTools().length);

        const history = options.messages.slice(0, -1);
        const lastMessage = options.messages[options.messages.length - 1];

        agent.setMessages(history);

        const gen = agent.stream(lastMessage.content);
        let fullResponse = '';

        // Collect all chunks from the stream
        for await (const chunk of gen) {
          if (typeof chunk === 'string' && chunk) {
            fullResponse += chunk;
            webContents.send('chat:chunk', chunk);
          }
        }

        // After the generator completes, try to get the return value
        // Async generators return their value when they're done
        let finalText = fullResponse;
        let agentResult: AgentResult | null = null;
        try {
          // The generator's return value is the AgentResult
          // We need to manually get it since for-await-of doesn't capture return values
          const result = await gen.next();
          if (result.done && result.value && typeof result.value === 'object') {
            agentResult = result.value;
            // Use the response from agent result if available and different
            if (agentResult?.response && agentResult.response.trim()) {
              finalText = agentResult.response;
            }
          }
        } catch (e) {
          // If we can't get the return value, use the collected chunks
          console.log('[Main] Could not get generator return value, using collected chunks:', e);
        }

        // Check for tool approval requests
        // Note: In AI SDK v6, tools execute automatically unless approval is required
        // If there are approval requests, send them to frontend but don't block execution
        if (agentResult?.toolApprovalRequests && agentResult.toolApprovalRequests.length > 0) {
          console.log('[Main] Tool approval requests found:', agentResult.toolApprovalRequests);
          // Send tool approval requests to frontend for user approval
          for (const approvalRequest of agentResult.toolApprovalRequests) {
            webContents.send('chat:tool-approval-request', approvalRequest);
          }
          // Note: We still send done because tools may have executed automatically
          // The approval requests are for future tool calls
        }

        // Ensure we send a non-empty response
        if (!finalText.trim() && fullResponse.trim()) {
          finalText = fullResponse;
        }

        // Send the final response
        webContents.send('chat:done', finalText || '');
        return { success: true };
      } else {
        const result = await llmFactory.streamChat(
          {
            providerType: options.providerType,
            modelId: options.model,
            messages: toLlmChatMessages(options.messages),
          },
          chunk => {
            webContents.send('chat:chunk', chunk);
          }
        );
        webContents.send('chat:done', result);
        return { success: true };
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      webContents.send('chat:error', message);
      return { success: false, error: message };
    }
  }
);

// Handle tool approval
ipcMain.handle('chat:approve-tool', async (_, approvalId: string, approved: boolean) => {
  console.log(`[Main] Tool approval: ${approvalId}, approved: ${approved}`);
  return {
    success: false,
    error: 'Tool approval flow is not implemented yet in current agent pipeline.',
  };
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
});

ipcMain.on('close-window', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

const createWindow = () => {
  // Create the browser window.
  console.log('[Main] Creating main window in ', __dirname);

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
