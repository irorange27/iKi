import { contextBridge, ipcRenderer } from 'electron';
import {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonControlResult,
  DaemonLogsInfo,
  DaemonStatusInfo,
  NetworkDiagnosticResult,
} from '@iki/backend/types/config';
import type { AppUpdateStatus } from '@iki/backend/types/update';
import type { CompanionSnapshot } from '@iki/backend/types/companion';
import type {
  Provider,
  ProviderUpdatedEvent,
  ProviderModelDiscoveryOverride,
} from '@iki/backend/types/provider';
import type { ChatUsagePeriod, ChatUsageSummary } from '@iki/backend/types/chat_usage';
import type { ProactiveTask } from '@iki/backend/types/tasks';
import type { McpServerInput, McpServerSummary } from '@iki/backend/types/mcp';
import type { AgentRun, AgentRunTrace, AgentRunTree } from '@iki/backend/types/agent_run';
import type { DevToolsResolveRequest, DevToolsSourceResult } from '@iki/backend/types/devtools';
import type { DevRuntimeStatus } from '@iki/backend/types/devtools';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from '@iki/backend/types/speech';
import type {
  ChatInvocationOptions,
  ElectronApi,
  PromptAppInput,
  ProactiveTaskInput,
  ProviderInput,
  WorkspaceInput,
  ChatThreadInput,
  ChatMessageInput,
} from '@iki/backend/types/electron_api';
import { toPlainData } from '@iki/backend/utils/plain_clone';

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
    add: (provider: ProviderInput) => ipcRenderer.invoke('providers:add', provider),
    update: (id: string, provider: Partial<Provider>) =>
      ipcRenderer.invoke('providers:update', id, provider),
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
    send: (options: ChatInvocationOptions) => ipcRenderer.invoke('chat:send', options),
    stream: (options: ChatInvocationOptions) => ipcRenderer.invoke('chat:stream', options),
    stopStream: () => ipcRenderer.invoke('chat:stop-stream'),
    steerStream: (threadId: string | undefined, message: string) =>
      ipcRenderer.invoke('chat:steer-stream', threadId, message),
    onUiChunk: (callback: (chunk: unknown) => void) => subscribe('chat:ui-chunk', callback),
    approveTool: (approvalId: string, approved: boolean) => {
      return ipcRenderer.invoke('chat:approve-tool', approvalId, approved);
    },
    onRunStatus: (
      callback: (event: import('@iki/backend/types/electron_api').RunStatusEvent) => void
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
      get: (id: string) => ipcRenderer.invoke('chat:messages:get', id),
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
      getTree: (rootRunId: string): Promise<AgentRunTree> =>
        ipcRenderer.invoke('chat:runs:tree:get', rootRunId),
      trajectory: (runId: string) => ipcRenderer.invoke('chat:runs:trajectory:get', runId),
      cancel: (runId: string) => ipcRenderer.invoke('chat:runs:cancel', runId),
      retryAndExecute: (runId: string) => ipcRenderer.invoke('chat:runs:retry-and-execute', runId),
      resume: (runId: string) => ipcRenderer.invoke('chat:runs:resume', runId),
      reviewQueue: (limit?: number) => ipcRenderer.invoke('chat:runs:review-queue', limit),
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
    get: (id: string) => ipcRenderer.invoke('workspaces:get', id),
    getByPath: (path: string) => ipcRenderer.invoke('workspaces:getByPath', path),
    getVisible: () => ipcRenderer.invoke('workspaces:getVisible'),
    pickDirectory: () => ipcRenderer.invoke('workspaces:pickDirectory'),
    create: (workspace: WorkspaceInput) => ipcRenderer.invoke('workspaces:create', workspace),
    update: (id: string, workspace: WorkspaceInput) =>
      ipcRenderer.invoke('workspaces:update', id, workspace),
    delete: (id: string) => ipcRenderer.invoke('workspaces:delete', id),
    toggleVisibility: (id: string) => ipcRenderer.invoke('workspaces:toggleVisibility', id),
    initAgentInstructions: (threadId: string) =>
      ipcRenderer.invoke('workspaces:init-agent-instructions', threadId),
    createThreadWorktree: (threadId: string, repoWorkspaceId?: string | null) =>
      ipcRenderer.invoke('workspaces:create-thread-worktree', threadId, repoWorkspaceId ?? null),
    removeThreadWorktree: (threadId: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke('workspaces:remove-thread-worktree', threadId, options ?? {}),
    mergeThreadWorktree: (threadId: string) =>
      ipcRenderer.invoke('workspaces:merge-thread-worktree', threadId),
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
    create: (task: ProactiveTaskInput) => ipcRenderer.invoke('tasks:create', toPlainData(task)),
    update: (id: string, updates: Partial<ProactiveTask>) =>
      ipcRenderer.invoke('tasks:update', id, toPlainData(updates)),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    runNow: (id: string) => ipcRenderer.invoke('tasks:run-now', id),
    onPush: (callback: (payload: unknown) => void) => subscribe('tasks:push', callback),
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
  openSettings: (section?: string) => ipcRenderer.send('open-settings', section),
  focusThread: (threadId: string) => ipcRenderer.send('chat:focus-thread', threadId),
  onFocusThread: (callback: (threadId: string) => void) =>
    subscribe('chat:thread-activate', callback),
  closeWindow: () => ipcRenderer.send('close-window'),
  setWindowShadow: (enabled: boolean) => ipcRenderer.send('window:set-shadow', enabled),
  ...(process.platform === 'darwin'
    ? {
        windowControls: {
          minimize: () => ipcRenderer.send('minimize-window'),
          toggleMaximize: () => ipcRenderer.send('toggle-maximize-window'),
          onFullscreenChange: (callback: (fullscreen: boolean) => void) =>
            subscribe('window:fullscreen-changed', callback),
          onFocusChange: (callback: (focused: boolean) => void) =>
            subscribe('window:focus-changed', callback),
        },
      }
    : {}),
};

contextBridge.exposeInMainWorld('electronAPI', electronApi);
