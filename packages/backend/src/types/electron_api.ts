import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonControlResult,
  DaemonLogsInfo,
  DaemonStatusInfo,
  NetworkDiagnosticResult,
} from './config';
import type {
  Provider,
  ProviderModelDescriptor,
  ProviderModelDiscoveryOverride,
  ProviderUpdatedEvent,
} from '@iki/backend/types/provider';
import type { ChatMessage, ChatThread, PromptApp, Workspace } from './chat';
import type { ChatUsagePeriod, ChatUsageSummary } from './chat_usage';
import type {
  AffectStateEntry,
  LongMemoryEntry,
  LongMemorySearchResult,
  ShortMemoryEntry,
} from './memory';
import type { ProactiveTask } from './tasks';
import type { McpServerInput, McpServerSummary } from '@iki/backend/types/mcp';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from './speech';
import type { SkillSource, SkillSummary } from './skill';
import type { TaskPlan } from './task_plan';
import type { AppUpdateStatus } from './update';
import type { AgentRun, AgentEvalComparison, AgentEvalLabel, AgentRunStatus, AgentRunTrace, AgentRunTree, RegressionAssessment } from '@iki/backend/types/agent_run';
import type { CompanionSnapshot } from './companion';
import type { ChatInvocationOptions, ChatInvocationResult } from './chat_invocation';
export type { ChatInvocationOptions, ChatInvocationResult };

export type ProviderInput = Partial<Provider> &
  Pick<Provider, 'id' | 'name' | 'type' | 'api_key' | 'models'>;

export type ChatThreadInput = Partial<ChatThread>;
export type ChatMessageInput = Partial<ChatMessage>;
export type WorkspaceInput = Partial<Workspace>;
export type PromptAppInput = Partial<PromptApp>;

export type ShortMemoryInput = {
  thread_id: string;
  message_id: string;
  role: string;
  content: string;
  emotion?: unknown;
  importance?: number;
};

export type LongMemoryInput = {
  thread_id: string;
  summary: string;
  source_message_ids?: string[];
  emotion?: unknown;
  tags?: string[];
  metadata?: unknown;
};

export type ProactiveTaskInput = Omit<Partial<ProactiveTask>, 'tools'> &
  Pick<ProactiveTask, 'name' | 'prompt' | 'provider_type' | 'model'> & {
    tools?: string[] | string | null;
  };

export type RunStatusEvent = {
  runId: string;
  status: AgentRunStatus;
  threadId?: string | null;
  timestamp: string;
};

export type AcpAuthMethod = {
  id: string;
  name: string;
  description?: string | null;
  type: 'env_var' | 'terminal' | 'agent';
  link?: string | null;
  vars?: Array<{ name: string; description?: string | null; secret?: boolean }>;
};

export type ToolModelConfig = {
  providerId?: string;
  providerType?: string;
  model: string;
};

export type ToolModelLatencyTestResult = {
  success: boolean;
  providerId?: string;
  providerType?: string;
  model?: string;
  responseTimeMs?: number;
  error?: string;
};

export type WindowActionResult = {
  success: boolean;
  error?: string;
  path?: string;
};

export type SkillReadResult = WindowActionResult & {
  id?: string;
  name?: string;
  source?: SkillSource;
  filePath?: string;
  content?: string;
  truncated?: boolean;
};

export type SkillRootEntry = {
  source: SkillSource;
  path: string;
};

export type ToolMetadata = {
  name: string;
  type: string;
  description: string;
  parameters: unknown;
  outputSchema?: unknown;
  displayName?: string;
  source?: {
    kind: 'builtin' | 'mcp';
    id?: string;
    name?: string;
  };
  needsApproval?: boolean;
  approvalMode?: 'configurable' | 'always';
  autoAllowed?: boolean;
};

export interface ElectronApi {
  config: {
    get: () => Promise<AppConfig>;
    getRuntimeInfo: () => Promise<ConfigRuntimeInfo>;
    getDaemonStatus: () => Promise<DaemonStatusInfo>;
    getDaemonLogs: (limit?: number) => Promise<DaemonLogsInfo>;
    controlDaemon: (action: DaemonControlAction) => Promise<DaemonControlResult>;
    testNetwork: (network: AppConfig['network']) => Promise<NetworkDiagnosticResult>;
    set: (config: AppConfig) => Promise<unknown>;
    onUpdated: (callback: (config: AppConfig) => void) => () => void;
  };
  updates: {
    getStatus: () => Promise<AppUpdateStatus>;
    check: () => Promise<AppUpdateStatus>;
    install: () => Promise<void>;
    onStatusChanged: (callback: (status: AppUpdateStatus) => void) => () => void;
    removeAllListeners: () => void;
  };
  providers: {
    list: () => Promise<Provider[]>;
    get: (id: string) => Promise<Provider | null>;
    add: (provider: ProviderInput) => Promise<unknown>;
    update: (id: string, provider: Partial<Provider>) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    onUpdated: (callback: (event: ProviderUpdatedEvent) => void) => () => void;
  };
  chat: {
    getModels: (
      providerType: string,
      providerId?: string,
      providerOverride?: ProviderModelDiscoveryOverride | null
    ) => Promise<ProviderModelDescriptor[]>;
    getAcpAuthMethods: (
      providerType: string,
      providerId?: string,
      providerOverride?: ProviderModelDiscoveryOverride | null
    ) => Promise<AcpAuthMethod[]>;
    isProviderConfigured: (providerType: string, providerId?: string) => Promise<boolean>;
    send: (options: ChatInvocationOptions) => Promise<ChatInvocationResult>;
    stream: (options: ChatInvocationOptions) => Promise<ChatInvocationResult>;
    stopStream: () => Promise<ChatInvocationResult>;
    steerStream: (message: string) => Promise<ChatInvocationResult>;
    onUiChunk: (callback: (chunk: unknown) => void) => () => void;
    approveTool: (approvalId: string, approved: boolean) => Promise<ChatInvocationResult>;
    onRunStatus: (callback: (event: RunStatusEvent) => void) => () => void;
    removeAllListeners: () => void;
    threads: {
      list: () => Promise<ChatThread[]>;
      get: (id: string) => Promise<ChatThread | null>;
      getTodoPlan: (threadId: string) => Promise<TaskPlan | null>;
      create: (thread: ChatThreadInput) => Promise<ChatThread>;
      clear: (id: string, thread: ChatThreadInput) => Promise<ChatThread | null>;
      update: (id: string, thread: ChatThreadInput) => Promise<unknown>;
      delete: (id: string) => Promise<unknown>;
    };
    messages: {
      list: (threadId: string) => Promise<ChatMessage[]>;
      get: (id: string) => Promise<ChatMessage | null>;
      create: (message: ChatMessageInput) => Promise<ChatMessage | null>;
      update: (id: string, message: ChatMessageInput) => Promise<unknown>;
      delete: (id: string) => Promise<unknown>;
    };
    runs: {
      list: (threadId: string) => Promise<AgentRun[]>;
      getTrace: (runId: string) => Promise<AgentRunTrace | null>;
      getTree: (rootRunId: string) => Promise<AgentRunTree>;
      cancel: (runId: string) => Promise<{ success: boolean; error?: string }>;
      retry: (runId: string) => Promise<{ success: boolean; error?: string; newRunId?: string }>;
      retryAndExecute: (runId: string) => Promise<{ success: boolean; error?: string; newRunId?: string }>;
      resume: (runId: string) => Promise<{ success: boolean; error?: string }>;
      listByStatus: (statuses: string[], opts?: { limit?: number; clientId?: string }) => Promise<AgentRun[]>;
      eval: {
        exportTrace: (runId: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
        addLabel: (input: { runId: string; stepId?: string | null; label: string; note?: string | null }) => Promise<AgentEvalLabel>;
        listLabels: (runId: string) => Promise<AgentEvalLabel[]>;
        deleteLabel: (labelId: string) => Promise<{ success: boolean }>;
        compareRuns: (baselineRunId: string, testRunId: string) => Promise<AgentEvalComparison | null>;
        assessRegression: (baselineRunId: string, testRunId: string) => Promise<RegressionAssessment | null>;
      };
    };
    usage: {
      summary: (period?: ChatUsagePeriod) => Promise<ChatUsageSummary>;
    };
  };
  memory: {
    short: {
      list: (threadId: string, limit?: number) => Promise<ShortMemoryEntry[]>;
      add: (entry: ShortMemoryInput) => Promise<unknown>;
      listAll: (limit?: number) => Promise<ShortMemoryEntry[]>;
    };
    long: {
      add: (entry: LongMemoryInput) => Promise<unknown>;
      update: (id: string, updates: Partial<LongMemoryInput>) => Promise<unknown>;
      delete: (id: string) => Promise<unknown>;
      list: (threadId: string, limit?: number) => Promise<LongMemoryEntry[]>;
      listAll: (limit?: number) => Promise<LongMemoryEntry[]>;
      search: (
        threadId: string,
        query: string,
        options?: Record<string, unknown>
      ) => Promise<LongMemorySearchResult[]>;
      searchAll: (
        query: string,
        options?: Record<string, unknown>
      ) => Promise<LongMemorySearchResult[]>;
    };
    affect: {
      get: (threadId: string) => Promise<AffectStateEntry | null>;
    };
  };
  workspaces: {
    list: () => Promise<Workspace[]>;
    get: (id: string) => Promise<Workspace | null>;
    getByPath: (path: string) => Promise<Workspace | null>;
    getVisible: () => Promise<Workspace[]>;
    pickDirectory: () => Promise<Workspace | null>;
    create: (workspace: WorkspaceInput) => Promise<unknown>;
    update: (id: string, workspace: WorkspaceInput) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    toggleVisibility: (id: string) => Promise<unknown>;
    initAgentInstructions: (threadId: string) => Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>;
  };
  promptApps: {
    list: () => Promise<PromptApp[]>;
    get: (id: string) => Promise<PromptApp | null>;
    getEnabled: () => Promise<PromptApp[]>;
    create: (app: PromptAppInput) => Promise<unknown>;
    update: (id: string, app: PromptAppInput) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    toggleEnabled: (id: string) => Promise<unknown>;
    updateSortOrder: (id: string, sortOrder: number) => Promise<unknown>;
  };
  toolModel: {
    get: () => Promise<ToolModelConfig | null>;
    generateTitle: (conversationContent: string) => Promise<string | null>;
    testLatency: (config?: ToolModelConfig | null) => Promise<ToolModelLatencyTestResult>;
  };
  tools: {
    list: () => Promise<ToolMetadata[]>;
  };
  speech: {
    getStatus: () => Promise<SpeechStatus>;
    transcribe: (input: SpeechTranscriptionInput) => Promise<SpeechTranscriptionResult>;
    listModels: () => Promise<WhisperNodeModelInfo[]>;
    downloadModel: (modelName: string) => Promise<WhisperNodeDownloadResult>;
    onDownloadProgress: (callback: (payload: WhisperNodeDownloadProgress) => void) => () => void;
    removeAllListeners: () => void;
  };
  skills: {
    list: () => Promise<SkillSummary[]>;
    roots: () => Promise<SkillRootEntry[]>;
    openRoot: (source?: SkillSource) => Promise<WindowActionResult>;
    openSkill: (id: string) => Promise<WindowActionResult>;
    read: (id: string, options?: { maxChars?: number }) => Promise<SkillReadResult>;
  };
  workflow: {
    resetAutoPinnedSkills: () => Promise<WindowActionResult>;
  };
  tasks: {
    list: () => Promise<ProactiveTask[]>;
    get: (id: string) => Promise<ProactiveTask | null>;
    create: (
      task: ProactiveTaskInput
    ) => Promise<WindowActionResult & { task?: ProactiveTask | null }>;
    update: (
      id: string,
      updates: Omit<Partial<ProactiveTask>, 'tools'> & { tools?: string[] | string | null }
    ) => Promise<WindowActionResult & { task?: ProactiveTask | null }>;
    delete: (id: string) => Promise<WindowActionResult>;
    runNow: (id: string) => Promise<WindowActionResult>;
    onPush: (callback: (payload: unknown) => void) => () => void;
    removeAllListeners: () => void;
  };
  awaiters: {
    onPush: (callback: (payload: unknown) => void) => () => void;
    removeAllListeners: () => void;
  };
  mcp: {
    list: () => Promise<McpServerSummary[]>;
    add: (input: McpServerInput) => Promise<unknown>;
    update: (id: string, updates: Partial<McpServerInput>) => Promise<unknown>;
    delete: (id: string) => Promise<WindowActionResult>;
    connect: (id: string) => Promise<unknown>;
    disconnect: (id: string) => Promise<WindowActionResult>;
    refreshTools: (id: string) => Promise<unknown>;
  };
  companion: {
    getSnapshot: () => Promise<CompanionSnapshot>;
    onUpdated: (callback: (snapshot: CompanionSnapshot) => void) => () => void;
    openMainWindow: () => Promise<WindowActionResult>;
    disable: () => Promise<WindowActionResult>;
  };
  openSettings: (section?: string) => void;
  closeWindow: () => void;
  setWindowShadow: (enabled: boolean) => void;
}
