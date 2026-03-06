// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { AppConfig } from '../shared/types/config';
import type { Provider } from '../shared/types/provider';
import type { ChatMessage, ChatThread, Workspace, PromptApp } from '../shared/types/chat';

console.log('👋 This message is being logged by "preload.ts", included via Vite');

type ProviderInput = Partial<Provider> &
  Pick<Provider, 'id' | 'name' | 'type' | 'api_key' | 'models'>;
type ChatThreadInput = Partial<ChatThread>;
type ChatMessageInput = Partial<ChatMessage>;
type WorkspaceInput = Partial<Workspace>;
type PromptAppInput = Partial<PromptApp>;

contextBridge.exposeInMainWorld('electronAPI', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
    onUpdated: (callback: (config: AppConfig) => void) => {
      ipcRenderer.on('config:updated', (_event, config) => {
        callback(config);
      });
    },
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    get: (id: string) => ipcRenderer.invoke('providers:get', id),
    add: (provider: ProviderInput) => ipcRenderer.invoke('providers:add', provider),
    update: (id: string, provider: Partial<Provider>) =>
      ipcRenderer.invoke('providers:update', id, provider),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
  },
  chat: {
    getModels: (providerType: string) => ipcRenderer.invoke('chat:getModels', providerType),
    isProviderConfigured: (providerType: string) =>
      ipcRenderer.invoke('chat:isProviderConfigured', providerType),
    send: (options: {
      providerType: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
      tools?: string[];
    }) => ipcRenderer.invoke('chat:send', options),
    stream: (options: {
      providerType: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
      tools?: string[];
    }) => ipcRenderer.invoke('chat:stream', options),
    onChunk: (callback: (chunk: string) => void) => {
      ipcRenderer.on('chat:chunk', (_event, chunk) => callback(chunk));
    },
    onDone: (callback: (fullText: string) => void) => {
      ipcRenderer.on('chat:done', (_event, fullText) => callback(fullText));
    },
    onError: (callback: (error: string) => void) => {
      ipcRenderer.on('chat:error', (_event, error) => callback(error));
    },
    onToolApprovalRequest: (callback: (request: unknown) => void) => {
      ipcRenderer.on('chat:tool-approval-request', (_event, request) => callback(request));
    },
    approveTool: (approvalId: string, approved: boolean) => {
      return ipcRenderer.invoke('chat:approve-tool', approvalId, approved);
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('chat:chunk');
      ipcRenderer.removeAllListeners('chat:done');
      ipcRenderer.removeAllListeners('chat:error');
    },
    threads: {
      list: () => ipcRenderer.invoke('chat:threads:list'),
      get: (id: string) => ipcRenderer.invoke('chat:threads:get', id),
      create: (thread: ChatThreadInput) => ipcRenderer.invoke('chat:threads:create', thread),
      update: (id: string, thread: ChatThreadInput) =>
        ipcRenderer.invoke('chat:threads:update', id, thread),
      delete: (id: string) => ipcRenderer.invoke('chat:threads:delete', id),
    },
    messages: {
      list: (threadId: string) => ipcRenderer.invoke('chat:messages:list', threadId),
      get: (id: string) => ipcRenderer.invoke('chat:messages:get', id),
      create: (message: ChatMessageInput) => ipcRenderer.invoke('chat:messages:create', message),
      update: (id: string, message: ChatMessageInput) =>
        ipcRenderer.invoke('chat:messages:update', id, message),
      delete: (id: string) => ipcRenderer.invoke('chat:messages:delete', id),
    },
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    get: (id: string) => ipcRenderer.invoke('workspaces:get', id),
    getByPath: (path: string) => ipcRenderer.invoke('workspaces:getByPath', path),
    getVisible: () => ipcRenderer.invoke('workspaces:getVisible'),
    create: (workspace: WorkspaceInput) => ipcRenderer.invoke('workspaces:create', workspace),
    update: (id: string, workspace: WorkspaceInput) =>
      ipcRenderer.invoke('workspaces:update', id, workspace),
    delete: (id: string) => ipcRenderer.invoke('workspaces:delete', id),
    toggleVisibility: (id: string) => ipcRenderer.invoke('workspaces:toggleVisibility', id),
  },
  promptApps: {
    list: () => ipcRenderer.invoke('promptApps:list'),
    get: (id: string) => ipcRenderer.invoke('promptApps:get', id),
    getEnabled: () => ipcRenderer.invoke('promptApps:getEnabled'),
    create: (app: PromptAppInput) => ipcRenderer.invoke('promptApps:create', app),
    update: (id: string, app: PromptAppInput) => ipcRenderer.invoke('promptApps:update', id, app),
    delete: (id: string) => ipcRenderer.invoke('promptApps:delete', id),
    toggleEnabled: (id: string) => ipcRenderer.invoke('promptApps:toggleEnabled', id),
    updateSortOrder: (id: string, sortOrder: number) =>
      ipcRenderer.invoke('promptApps:updateSortOrder', id, sortOrder),
  },
  toolModel: {
    get: () => ipcRenderer.invoke('toolModel:get'),
    generateTitle: (conversationContent: string) =>
      ipcRenderer.invoke('toolModel:generateTitle', conversationContent),
  },
  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
