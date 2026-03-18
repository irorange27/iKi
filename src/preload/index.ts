// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { AppConfig } from '../shared/types/config';
import type { Provider } from '../shared/types/provider';
import type { ChatMessage, ChatThread, Workspace, PromptApp } from '../shared/types/chat';
import type { LongMemorySearchResult } from '../shared/types/memory';
import type { ProactiveTask } from '../shared/types/tasks';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from '../shared/types/speech';

console.log('👋 This message is being logged by "preload.ts", included via Vite');

type ProviderInput = Partial<Provider> &
  Pick<Provider, 'id' | 'name' | 'type' | 'api_key' | 'models'>;
type ChatThreadInput = Partial<ChatThread>;
type ChatMessageInput = Partial<ChatMessage>;
type WorkspaceInput = Partial<Workspace>;
type PromptAppInput = Partial<PromptApp>;
type ShortMemoryInput = {
  thread_id: string;
  message_id: string;
  role: string;
  content: string;
  emotion?: unknown;
  importance?: number;
};
type LongMemoryInput = {
  thread_id: string;
  summary: string;
  source_message_ids?: string[];
  emotion?: unknown;
  tags?: string[];
  metadata?: unknown;
};
type LongMemoryUpdateInput = Partial<Omit<LongMemoryInput, 'thread_id'>>;
type ProactiveTaskInput = Partial<ProactiveTask> &
  Pick<ProactiveTask, 'name' | 'prompt' | 'provider_type' | 'model' | 'interval_minutes'>;

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
      messages: Array<Record<string, unknown>>;
      tools?: string[];
      skillIds?: string[];
      skillMode?: 'manual' | 'auto';
      threadId?: string;
    }) => ipcRenderer.invoke('chat:send', options),
    stream: (options: {
      providerType: string;
      model: string;
      messages: Array<Record<string, unknown>>;
      tools?: string[];
      skillIds?: string[];
      skillMode?: 'manual' | 'auto';
      threadId?: string;
    }) => ipcRenderer.invoke('chat:stream', options),
    stopStream: () => ipcRenderer.invoke('chat:stop-stream'),
    onUiChunk: (callback: (chunk: unknown) => void) => {
      ipcRenderer.on('chat:ui-chunk', (_event, chunk) => callback(chunk));
    },
    approveTool: (approvalId: string, approved: boolean) => {
      return ipcRenderer.invoke('chat:approve-tool', approvalId, approved);
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('chat:ui-chunk');
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
  speech: {
    getStatus: (): Promise<SpeechStatus> => ipcRenderer.invoke('speech:get-status'),
    transcribe: (input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult> =>
      ipcRenderer.invoke('speech:transcribe', input),
    listModels: (): Promise<WhisperNodeModelInfo[]> => ipcRenderer.invoke('speech:list-models'),
    downloadModel: (modelName: string): Promise<WhisperNodeDownloadResult> =>
      ipcRenderer.invoke('speech:download-model', modelName),
    onDownloadProgress: (callback: (payload: WhisperNodeDownloadProgress) => void) => {
      ipcRenderer.on('speech:download-progress', (_event, payload) => callback(payload));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('speech:download-progress');
    },
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    roots: () => ipcRenderer.invoke('skills:roots'),
    openRoot: (source?: 'user' | 'codex') => ipcRenderer.invoke('skills:open-root', source),
    openSkill: (id: string) => ipcRenderer.invoke('skills:open-skill', id),
    read: (id: string, options?: { maxChars?: number }) =>
      ipcRenderer.invoke('skills:read', id, options),
  },
  workflow: {
    resetAutoPinnedSkills: () => ipcRenderer.invoke('workflow:reset-auto-skills'),
  },
  memory: {
    short: {
      list: (threadId: string, limit?: number) =>
        ipcRenderer.invoke('memory:short:list', threadId, limit),
      listAll: (limit?: number) => ipcRenderer.invoke('memory:short:listAll', limit),
      add: (entry: ShortMemoryInput) => ipcRenderer.invoke('memory:short:add', entry),
    },
    long: {
      add: (entry: LongMemoryInput) => ipcRenderer.invoke('memory:long:add', entry),
      update: (id: string, updates: LongMemoryUpdateInput) =>
        ipcRenderer.invoke('memory:long:update', id, updates),
      delete: (id: string) => ipcRenderer.invoke('memory:long:delete', id),
      list: (threadId: string, limit?: number) =>
        ipcRenderer.invoke('memory:long:list', threadId, limit),
      listAll: (limit?: number) => ipcRenderer.invoke('memory:long:listAll', limit),
      search: (
        threadId: string,
        query: string,
        options?: { limit?: number; threshold?: number; force?: boolean }
      ): Promise<LongMemorySearchResult[]> =>
        ipcRenderer.invoke('memory:long:search', threadId, query, options),
      searchAll: (
        query: string,
        options?: { limit?: number; threshold?: number; force?: boolean }
      ): Promise<LongMemorySearchResult[]> =>
        ipcRenderer.invoke('memory:long:searchAll', query, options),
    },
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (task: ProactiveTaskInput) => ipcRenderer.invoke('tasks:create', task),
    update: (id: string, updates: Partial<ProactiveTask>) =>
      ipcRenderer.invoke('tasks:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    runNow: (id: string) => ipcRenderer.invoke('tasks:run-now', id),
    onPush: (callback: (payload: unknown) => void) => {
      ipcRenderer.on('tasks:push', (_event, payload) => callback(payload));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('tasks:push');
    },
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
