// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { AppConfig } from '../shared/types/config';

console.log('👋 This message is being logged by "preload.ts", included via Vite');

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
    add: (provider: any) => ipcRenderer.invoke('providers:add', provider),
    update: (id: string, provider: any) => ipcRenderer.invoke('providers:update', id, provider),
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
    }) => ipcRenderer.invoke('chat:send', options),
    stream: (options: {
      providerType: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
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
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('chat:chunk');
      ipcRenderer.removeAllListeners('chat:done');
      ipcRenderer.removeAllListeners('chat:error');
    },
    threads: {
      list: () => ipcRenderer.invoke('chat:threads:list'),
      get: (id: string) => ipcRenderer.invoke('chat:threads:get', id),
      create: (thread: any) => ipcRenderer.invoke('chat:threads:create', thread),
      update: (id: string, thread: any) => ipcRenderer.invoke('chat:threads:update', id, thread),
      delete: (id: string) => ipcRenderer.invoke('chat:threads:delete', id),
    },
    messages: {
      list: (threadId: string) => ipcRenderer.invoke('chat:messages:list', threadId),
      get: (id: string) => ipcRenderer.invoke('chat:messages:get', id),
      create: (message: any) => ipcRenderer.invoke('chat:messages:create', message),
      update: (id: string, message: any) => ipcRenderer.invoke('chat:messages:update', id, message),
      delete: (id: string) => ipcRenderer.invoke('chat:messages:delete', id),
    },
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    get: (id: string) => ipcRenderer.invoke('workspaces:get', id),
    getByPath: (path: string) => ipcRenderer.invoke('workspaces:getByPath', path),
    getVisible: () => ipcRenderer.invoke('workspaces:getVisible'),
    create: (workspace: any) => ipcRenderer.invoke('workspaces:create', workspace),
    update: (id: string, workspace: any) => ipcRenderer.invoke('workspaces:update', id, workspace),
    delete: (id: string) => ipcRenderer.invoke('workspaces:delete', id),
    toggleVisibility: (id: string) => ipcRenderer.invoke('workspaces:toggleVisibility', id),
  },
  promptApps: {
    list: () => ipcRenderer.invoke('promptApps:list'),
    get: (id: string) => ipcRenderer.invoke('promptApps:get', id),
    getEnabled: () => ipcRenderer.invoke('promptApps:getEnabled'),
    create: (app: any) => ipcRenderer.invoke('promptApps:create', app),
    update: (id: string, app: any) => ipcRenderer.invoke('promptApps:update', id, app),
    delete: (id: string) => ipcRenderer.invoke('promptApps:delete', id),
    toggleEnabled: (id: string) => ipcRenderer.invoke('promptApps:toggleEnabled', id),
    updateSortOrder: (id: string, sortOrder: number) =>
      ipcRenderer.invoke('promptApps:updateSortOrder', id, sortOrder),
  },
  toolModel: {
    get: () => ipcRenderer.invoke('toolModel:get'),
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
