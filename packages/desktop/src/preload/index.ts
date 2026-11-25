import { contextBridge, ipcRenderer } from 'electron';
import { toPlainData } from '@iki/core/utils/plain_clone';
import {
  AppConfig,
  ConfigRuntimeInfo,
  NetworkDiagnosticResult,
} from '@iki/core/types/config';
import type { AppUpdateStatus } from '@iki/core/types/update';
import type { CompanionSnapshot } from '@iki/core/types/companion';
import type {
  Provider,
  ProviderUpdatedEvent,
  ProviderModelDiscoveryOverride,
} from '@iki/core/types/provider';
import type { ChatUsagePeriod, ChatUsageSummary } from '@iki/core/types/chat_usage';
import type { McpServerInput, McpServerSummary } from '@iki/core/types/mcp';
import type { AgentRun, AgentRunTrace } from '@iki/core/types/agent_run';
import type { DevToolsResolveRequest, DevToolsSourceResult , DevRuntimeStatus } from '@iki/core/types/devtools';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from '@iki/core/types/speech';
import type {
  ChatInvocationOptions,
  ElectronApi,
  ProviderInput,
  ChatThreadInput,
  ChatMessageInput,
} from '../shared/electron_api';

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
    testNetwork: (network: AppConfig['network']): Promise<NetworkDiagnosticResult> =>
      ipcRenderer.invoke('config:test-network', network),
    set: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
    onUpdated: (callback: (config: AppConfig) => void) => subscribe('config:updated', callback),
  },
  updates: {
    getStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:get-status'),
    check: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updates:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
    onStatusChanged: (callback: (status: AppUpdateStatus) => void) =>
      subscribe('updates:status-changed', callback),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    get: (id: string) => ipcRenderer.invoke('providers:get', id),
    // Drafts come from Vue reactive state; structured clone rejects Proxy
    // objects ("An object could not be cloned"). Strip at this single IPC
    // exit instead of at every caller.
    add: (provider: ProviderInput) =>
      ipcRenderer.invoke('providers:add', toPlainData(provider)),
    update: (id: string, provider: Partial<Provider>) =>
      ipcRenderer.invoke('providers:update', id, toPlainData(provider)),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
    onUpdated: (callback: (event: ProviderUpdatedEvent) => void) =>
      subscribe('providers:updated', callback),
  },
  chat: {
    getModels: (
      providerType: string,
      providerId?: string,
      providerOverride?: ProviderModelDiscoveryOverride | null
    ) => ipcRenderer.invoke('chat:getModels', providerType, providerId, providerOverride ?? null),
    isProviderConfigured: (providerType: string, providerId?: string) =>
      ipcRenderer.invoke('chat:isProviderConfigured', providerType, providerId),
    stream: (options: ChatInvocationOptions) => ipcRenderer.invoke('chat:stream', options),
    stopStream: () => ipcRenderer.invoke('chat:stop-stream'),
    onUiChunk: (callback: (chunk: unknown) => void) => subscribe('chat:ui-chunk', callback),
    onRunStatus: (
      callback: (event: import('../shared/electron_api').RunStatusEvent) => void
    ) => subscribe('chat:run-status', callback),
    threads: {
      list: () => ipcRenderer.invoke('chat:threads:list'),
      get: (id: string) => ipcRenderer.invoke('chat:threads:get', id),
      create: (thread: ChatThreadInput) => ipcRenderer.invoke('chat:threads:create', thread),
      clear: (id: string, thread: ChatThreadInput) =>
        ipcRenderer.invoke('chat:threads:clear', id, thread),
      update: (id: string, thread: ChatThreadInput) =>
        ipcRenderer.invoke('chat:threads:update', id, thread),
      exportMarkdown: (threadId: string) =>
        ipcRenderer.invoke('chat:threads:export-markdown', threadId),
      delete: (id: string) => ipcRenderer.invoke('chat:threads:delete', id),
      searchContent: (query: string, limit?: number) =>
        ipcRenderer.invoke('chat:threads:search-content', query, limit),
    },
    messages: {
      list: (threadId: string) => ipcRenderer.invoke('chat:messages:list', threadId),
      update: (id: string, message: ChatMessageInput) =>
        ipcRenderer.invoke('chat:messages:update', id, message),
      truncateAfter: (threadId: string, messageId: string) =>
        ipcRenderer.invoke('chat:messages:truncate-after', threadId, messageId),
    },
    runs: {
      list: (threadId: string): Promise<AgentRun[]> =>
        ipcRenderer.invoke('chat:runs:list', threadId),
      getTrace: (runId: string): Promise<AgentRunTrace | null> =>
        ipcRenderer.invoke('chat:runs:trace:get', runId),
      cancel: (runId: string) => ipcRenderer.invoke('chat:runs:cancel', runId),
      retryAndExecute: (runId: string) => ipcRenderer.invoke('chat:runs:retry-and-execute', runId),
      resume: (runId: string) => ipcRenderer.invoke('chat:runs:resume', runId),
      eval: {
        exportTrace: (runId: string) => ipcRenderer.invoke('chat:eval:export-trace', runId),
        addLabel: input => ipcRenderer.invoke('chat:eval:add-label', input),
        listLabels: (runId: string) => ipcRenderer.invoke('chat:eval:list-labels', runId),
        deleteLabel: (labelId: string) => ipcRenderer.invoke('chat:eval:delete-label', labelId),
      },
    },
    usage: {
      summary: (period: ChatUsagePeriod = '30d'): Promise<ChatUsageSummary> =>
        ipcRenderer.invoke('chat:usage:summary', period),
    },
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    getVisible: () => ipcRenderer.invoke('workspaces:getVisible'),
    pickDirectory: () => ipcRenderer.invoke('workspaces:pickDirectory'),
    initAgentInstructions: (threadId: string) =>
      ipcRenderer.invoke('workspaces:init-agent-instructions', threadId),
  },
  promptApps: {
    getEnabled: () => ipcRenderer.invoke('promptApps:getEnabled'),
  },
  toolModel: {
    get: () => ipcRenderer.invoke('toolModel:get'),
    generateTitle: (conversationContent: string) =>
      ipcRenderer.invoke('toolModel:generateTitle', conversationContent),
    testLatency: (config?: { providerId?: string; providerType?: string; model: string } | null) =>
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
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    roots: () => ipcRenderer.invoke('skills:roots'),
    openRoot: (source?: 'user' | 'agent') => ipcRenderer.invoke('skills:open-root', source),
    openSkill: (id: string) => ipcRenderer.invoke('skills:open-skill', id),
    read: (id: string, options?: { maxChars?: number }) =>
      ipcRenderer.invoke('skills:read', id, options),
  },
  awaiters: {
    onPush: (callback: (payload: unknown) => void) => subscribe('awaiters:push', callback),
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
  companion: {
    getSnapshot: (): Promise<CompanionSnapshot> => ipcRenderer.invoke('companion:get-snapshot'),
    onUpdated: (callback: (snapshot: CompanionSnapshot) => void) =>
      subscribe('companion:updated', callback),
    openMainWindow: () => ipcRenderer.invoke('companion:open-main-window'),
    disable: () => ipcRenderer.invoke('companion:disable'),
  },
  dev: {
    getStatus: (): Promise<DevRuntimeStatus> => ipcRenderer.invoke('dev:get-status'),
    restartApp: (): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('dev:restart-app'),
  },
  devtools: {
    installRecorder: (request?: DevToolsResolveRequest): Promise<DevToolsSourceResult> =>
      ipcRenderer.invoke('devtools:install-recorder', request),
    probeElement: (request?: DevToolsResolveRequest): Promise<DevToolsSourceResult> =>
      ipcRenderer.invoke('devtools:probe-element', request),
    resolveElement: (request?: DevToolsResolveRequest): Promise<DevToolsSourceResult> =>
      ipcRenderer.invoke('devtools:resolve-element', request),
  },
  onOpenSettings: (callback: () => void) => subscribe('app:open-settings', callback),
  closeWindow: () => ipcRenderer.send('close-window'),
  setWindowShadow: (enabled: boolean) => ipcRenderer.send('window:set-shadow', enabled),
};

contextBridge.exposeInMainWorld('electronAPI', electronApi);
