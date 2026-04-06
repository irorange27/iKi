// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonControlResult,
  DaemonLogsInfo,
  DaemonStatusInfo,
} from '../shared/types/config';
import type { AppUpdateStatus } from '../shared/types/update';
import type { Provider, ProviderUpdatedEvent } from '../shared/types/provider';
import type { ChatUsagePeriod, ChatUsageSummary } from '../shared/types/chat_usage';
import type { AffectStateEntry } from '../shared/types/memory';
import type { LifeOverview, LifeOwnerMode, LifeSnapshot } from '../shared/types/life';
import type { ProactiveTask } from '../shared/types/tasks';
import type { McpServerInput, McpServerSummary } from '../shared/types/mcp';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from '../shared/types/speech';
import type {
  ChatInvocationOptions,
  ElectronApi,
  LongMemoryInput,
  PromptAppInput,
  ProactiveTaskInput,
  ProviderInput,
  ShortMemoryInput,
  WorkspaceInput,
  ChatThreadInput,
  ChatMessageInput,
} from '../shared/types/electron_api';
import { toIpcSerializable } from '../shared/utils/ipc_serialization';

const subscribe = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => {
    callback(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const electronApi: ElectronApi = {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    getRuntimeInfo: (): Promise<ConfigRuntimeInfo> => ipcRenderer.invoke('config:get-runtime-info'),
    getDaemonStatus: (): Promise<DaemonStatusInfo> =>
      ipcRenderer.invoke('config:get-daemon-status'),
    getDaemonLogs: (limit?: number): Promise<DaemonLogsInfo> =>
      ipcRenderer.invoke('config:get-daemon-logs', limit),
    controlDaemon: (action: DaemonControlAction): Promise<DaemonControlResult> =>
      ipcRenderer.invoke('config:control-daemon', action),
    set: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
    onUpdated: (callback: (config: AppConfig) => void) => subscribe('config:updated', callback),
  },
  updates: {
    getStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:get-status'),
    check: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
    onStatusChanged: (callback: (status: AppUpdateStatus) => void) =>
      subscribe('updates:status-changed', callback),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('updates:status-changed');
    },
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    get: (id: string) => ipcRenderer.invoke('providers:get', id),
    add: (provider: ProviderInput) => ipcRenderer.invoke('providers:add', provider),
    update: (id: string, provider: Partial<Provider>) =>
      ipcRenderer.invoke('providers:update', id, provider),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
    onUpdated: (callback: (event: ProviderUpdatedEvent) => void) =>
      subscribe('providers:updated', callback),
  },
  chat: {
    getModels: (providerType: string) => ipcRenderer.invoke('chat:getModels', providerType),
    isProviderConfigured: (providerType: string, providerId?: string) =>
      ipcRenderer.invoke('chat:isProviderConfigured', providerType, providerId),
    send: (options: ChatInvocationOptions) => ipcRenderer.invoke('chat:send', options),
    stream: (options: ChatInvocationOptions) => ipcRenderer.invoke('chat:stream', options),
    stopStream: () => ipcRenderer.invoke('chat:stop-stream'),
    onUiChunk: (callback: (chunk: unknown) => void) => subscribe('chat:ui-chunk', callback),
    approveTool: (approvalId: string, approved: boolean) => {
      return ipcRenderer.invoke('chat:approve-tool', approvalId, approved);
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('chat:ui-chunk');
    },
    threads: {
      list: () => ipcRenderer.invoke('chat:threads:list'),
      get: (id: string) => ipcRenderer.invoke('chat:threads:get', id),
      getTodoPlan: (threadId: string) => ipcRenderer.invoke('chat:threads:todo:get', threadId),
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
    usage: {
      summary: (period: ChatUsagePeriod = '30d'): Promise<ChatUsageSummary> =>
        ipcRenderer.invoke('chat:usage:summary', period),
    },
  },
  memory: {
    short: {
      list: (threadId: string, limit?: number) =>
        ipcRenderer.invoke('memory:short:list', threadId, limit),
      add: (entry: ShortMemoryInput) => ipcRenderer.invoke('memory:short:add', entry),
      listAll: (limit?: number) => ipcRenderer.invoke('memory:short:listAll', limit),
    },
    long: {
      add: (entry: LongMemoryInput) => ipcRenderer.invoke('memory:long:add', entry),
      update: (id: string, updates: Partial<LongMemoryInput>) =>
        ipcRenderer.invoke('memory:long:update', id, updates),
      delete: (id: string) => ipcRenderer.invoke('memory:long:delete', id),
      list: (threadId: string, limit?: number) =>
        ipcRenderer.invoke('memory:long:list', threadId, limit),
      listAll: (limit?: number) => ipcRenderer.invoke('memory:long:listAll', limit),
      search: (threadId: string, query: string, options?: Record<string, unknown>) =>
        ipcRenderer.invoke('memory:long:search', threadId, query, options),
      searchAll: (query: string, options?: Record<string, unknown>) =>
        ipcRenderer.invoke('memory:long:searchAll', query, options),
    },
    affect: {
      get: (threadId: string): Promise<AffectStateEntry | null> =>
        ipcRenderer.invoke('memory:affect:get', threadId),
    },
  },
  life: {
    getOverview: (limit?: number): Promise<LifeOverview> =>
      ipcRenderer.invoke('life:get-overview', limit),
    refresh: (): Promise<LifeSnapshot | null> => ipcRenderer.invoke('life:refresh'),
    setOwnerMode: (mode: LifeOwnerMode, note?: string | null): Promise<LifeSnapshot | null> =>
      ipcRenderer.invoke('life:set-owner-mode', mode, note),
    clearOwnerMode: (): Promise<LifeSnapshot | null> => ipcRenderer.invoke('life:clear-owner-mode'),
    onPush: (callback: (payload: unknown) => void) => subscribe('life:push', callback),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('life:push');
    },
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    get: (id: string) => ipcRenderer.invoke('workspaces:get', id),
    getByPath: (path: string) => ipcRenderer.invoke('workspaces:getByPath', path),
    getVisible: () => ipcRenderer.invoke('workspaces:getVisible'),
    pickDirectory: () => ipcRenderer.invoke('workspaces:pickDirectory'),
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
    testLatency: (config?: { providerType: string; model: string } | null) =>
      ipcRenderer.invoke('toolModel:testLatency', config ?? null),
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
    onDownloadProgress: (callback: (payload: WhisperNodeDownloadProgress) => void) =>
      subscribe('speech:download-progress', callback),
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
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (task: ProactiveTaskInput) =>
      ipcRenderer.invoke('tasks:create', toIpcSerializable(task)),
    update: (id: string, updates: Partial<ProactiveTask>) =>
      ipcRenderer.invoke('tasks:update', id, toIpcSerializable(updates)),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    runNow: (id: string) => ipcRenderer.invoke('tasks:run-now', id),
    onPush: (callback: (payload: unknown) => void) => subscribe('tasks:push', callback),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('tasks:push');
    },
  },
  mcp: {
    list: (): Promise<McpServerSummary[]> => ipcRenderer.invoke('mcp:list'),
    add: (input: McpServerInput) => ipcRenderer.invoke('mcp:add', input),
    update: (id: string, updates: Partial<McpServerInput>) =>
      ipcRenderer.invoke('mcp:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('mcp:delete', id),
    connect: (id: string) => ipcRenderer.invoke('mcp:connect', id),
    disconnect: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
    refreshTools: (id: string) => ipcRenderer.invoke('mcp:refresh-tools', id),
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  closeWindow: () => ipcRenderer.send('close-window'),
  setWindowShadow: (enabled: boolean) => ipcRenderer.send('window:set-shadow', enabled),
};

contextBridge.exposeInMainWorld('electronAPI', electronApi);
