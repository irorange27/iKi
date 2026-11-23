import type {
  AppConfig,
  ConfigRuntimeInfo,
  NetworkDiagnosticResult,
} from '@iki/core/types/config';
import type {
  Provider,
  ProviderModelDescriptor,
  ProviderModelDiscoveryOverride,
  ProviderUpdatedEvent,
} from '@iki/core/types/provider';
import type { ChatThread, PromptApp, Workspace } from '@iki/core/types/chat';
import type { ChatUsagePeriod, ChatUsageSummary } from '@iki/core/types/chat_usage';
import type { ChatUiMessage } from '@iki/llm/message/message_parts';
import type { DevRuntimeStatus, DevToolsResolveRequest, DevToolsSourceResult } from '@iki/core/types/devtools';
import type {
  McpServer,
  McpServerInput,
  McpServerStatus,
  McpServerSummary,
  McpToolCatalogItem,
} from '@iki/core/types/mcp';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from '@iki/core/types/speech';
import type { SkillSource, SkillSummary } from '@iki/core/types/skill';
import type { AppUpdateStatus } from '@iki/core/types/update';
import type {
  AgentRun,
  AgentEvalLabel,
  AgentRunTrace,
} from '@iki/core/types/agent_run';
import type { CompanionSnapshot } from '@iki/core/types/companion';
import type { ChatInvocationOptions, ChatInvocationResult } from './chat_invocation';
import type { RunStatusEvent } from '@iki/harness/thread_session/types';
export type { ChatInvocationOptions, ChatInvocationResult };
export type { RunStatusEvent };

export type ProviderInput = Partial<Provider> &
  Pick<Provider, 'id' | 'name' | 'type' | 'apiKey' | 'models'>;

export type ChatThreadInput = Partial<ChatThread>;
/**
 * The message an IPC caller hands over, in the one shape that exists: the
 * structured ChatUiMessage the session log stores. Electron structured-clones
 * it across the bridge — the `| string` escape hatch and the write-only
 * `metadata` marker existed only to shuttle a fake row-shaped copy, and both
 * are gone.
 */
export type ChatMessageInput = {
  message: ChatUiMessage;
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

type WindowActionResult = {
  success: boolean;
  error?: string;
  path?: string;
};

type SkillReadResult = WindowActionResult & {
  id?: string;
  name?: string;
  source?: SkillSource;
  filePath?: string;
  content?: string;
  truncated?: boolean;
};

type SkillRootEntry = {
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
    testNetwork: (network: AppConfig['network']) => Promise<NetworkDiagnosticResult>;
    set: (config: AppConfig) => Promise<void>;
    onUpdated: (callback: (config: AppConfig) => void) => () => void;
  };
  updates: {
    getStatus: () => Promise<AppUpdateStatus>;
    check: () => Promise<AppUpdateStatus>;
    install: () => Promise<void>;
    onStatusChanged: (callback: (status: AppUpdateStatus) => void) => () => void;
  };
  providers: {
    list: () => Promise<Provider[]>;
    get: (id: string) => Promise<Provider | null>;
    add: (provider: ProviderInput) => Promise<Provider>;
    update: (id: string, provider: Partial<Provider>) => Promise<Provider | null>;
    delete: (id: string) => Promise<void>;
    onUpdated: (callback: (event: ProviderUpdatedEvent) => void) => () => void;
  };
  chat: {
    getModels: (
      providerType: string,
      providerId?: string,
      providerOverride?: ProviderModelDiscoveryOverride | null
    ) => Promise<ProviderModelDescriptor[]>;
    isProviderConfigured: (providerType: string, providerId?: string) => Promise<boolean>;
    stream: (options: ChatInvocationOptions) => Promise<ChatInvocationResult>;
    stopStream: () => Promise<ChatInvocationResult>;
    onUiChunk: (callback: (chunk: unknown) => void) => () => void;
    onRunStatus: (callback: (event: RunStatusEvent) => void) => () => void;
    threads: {
      list: () => Promise<ChatThread[]>;
      get: (id: string) => Promise<ChatThread | null>;
      create: (thread: ChatThreadInput) => Promise<ChatThread>;
      clear: (id: string, thread: ChatThreadInput) => Promise<ChatThread | null>;
      update: (id: string, thread: ChatThreadInput) => Promise<ChatThread | null>;
      exportMarkdown: (
        threadId: string
      ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      delete: (id: string) => Promise<void>;
      searchContent: (
        query: string,
        limit?: number
      ) => Promise<import('@iki/llm/message/thread_content_search').ThreadContentMatch[]>;
    };
    messages: {
      /** The session log's rebuilt view — the same ChatUiMessage values a resumed turn replays. */
      list: (threadId: string) => Promise<ChatUiMessage[]>;
      update: (id: string, message: ChatMessageInput) => Promise<boolean>;

      truncateAfter: (
        threadId: string,
        messageId: string
      ) => Promise<{ success: boolean; deletedIds: string[]; error?: string }>;
    };
    runs: {
      list: (threadId: string) => Promise<AgentRun[]>;
      getTrace: (runId: string) => Promise<AgentRunTrace | null>;
      cancel: (runId: string) => Promise<{ success: boolean; error?: string }>;
      retryAndExecute: (
        runId: string
      ) => Promise<{ success: boolean; error?: string; newRunId?: string }>;
      resume: (runId: string) => Promise<{ success: boolean; error?: string }>;
      eval: {
        exportTrace: (
          runId: string
        ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
        addLabel: (input: {
          runId: string;
          stepId?: string | null;
          label: string;
          note?: string | null;
        }) => Promise<AgentEvalLabel>;
        listLabels: (runId: string) => Promise<AgentEvalLabel[]>;
        deleteLabel: (labelId: string) => Promise<{ success: boolean }>;
      };
    };
    usage: {
      summary: (period?: ChatUsagePeriod) => Promise<ChatUsageSummary>;
    };
  };
  workspaces: {
    list: () => Promise<Workspace[]>;
    getVisible: () => Promise<Workspace[]>;
    pickDirectory: () => Promise<Workspace | null>;
    initAgentInstructions: (threadId: string) => Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>;
  };
  promptApps: {
    getEnabled: () => Promise<PromptApp[]>;
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
  };
  skills: {
    list: () => Promise<SkillSummary[]>;
    roots: () => Promise<SkillRootEntry[]>;
    openRoot: (source?: SkillSource) => Promise<WindowActionResult>;
    openSkill: (id: string) => Promise<WindowActionResult>;
    read: (id: string, options?: { maxChars?: number }) => Promise<SkillReadResult>;
  };
  awaiters: {
    onPush: (callback: (payload: unknown) => void) => () => void;
  };
  mcp: {
    list: () => Promise<McpServerSummary[]>;
    add: (input: McpServerInput) => Promise<McpServer>;
    update: (id: string, updates: Partial<McpServerInput>) => Promise<McpServer>;
    delete: (id: string) => Promise<WindowActionResult>;
    connect: (id: string) => Promise<McpServerStatus>;
    disconnect: (id: string) => Promise<WindowActionResult>;
    refreshTools: (id: string) => Promise<McpToolCatalogItem[]>;
  };
  companion: {
    getSnapshot: () => Promise<CompanionSnapshot>;
    onUpdated: (callback: (snapshot: CompanionSnapshot) => void) => () => void;
    openMainWindow: () => Promise<WindowActionResult>;
    disable: () => Promise<WindowActionResult>;
  };

  dev: {
    getStatus: () => Promise<DevRuntimeStatus>;
    restartApp: () => Promise<{ ok: boolean; reason?: string }>;
  };

  devtools: {
    installRecorder: (request?: DevToolsResolveRequest) => Promise<DevToolsSourceResult>;
    probeElement: (request?: DevToolsResolveRequest) => Promise<DevToolsSourceResult>;
    resolveElement: (request?: DevToolsResolveRequest) => Promise<DevToolsSourceResult>;
  };
  openSettings: (section?: string) => void;

  closeWindow: () => void;
  setWindowShadow: (enabled: boolean) => void;

  windowControls?: {
    minimize: () => void;
    toggleMaximize: () => void;
    onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
    onFocusChange: (callback: (focused: boolean) => void) => () => void;
  };
}
