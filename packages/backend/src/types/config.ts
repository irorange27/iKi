import type { WorkflowOptimizationConfig } from './workflow';
import type { ThemeConfig } from '@iki/theme/types';
import type {
  StructuredLogEntry,
  StructuredLogLevel,
  StructuredLogOutcome,
  StructuredLogProcess,
} from './logging';
import type { SupportedLocale } from '../i18n/locale';

export interface ConfigRuntimeInfo {
  userDataPath: string;
  dbPath: string;
  daemon: {
    defaultHost: string;
    defaultPort: number;
    configuredHost: string;
    configuredPort: number;
    napcatWsPath: string;
    localNapCatWsUrl: string;
    dockerNapCatWsUrl: string;
  };
}

export type NapCatBridgeRuntimeState =
  | 'disabled'
  | 'disconnected'
  | 'degraded'
  | 'connected'
  | 'unknown';

export interface NapCatBridgeHeartbeatInfo {
  lastReceivedAt: string | null;
  intervalMs: number | null;
  ageMs: number | null;
  online: boolean | null;
  good: boolean | null;
  stale: boolean | null;
}

export interface NapCatBridgeStatusInfo {
  state: NapCatBridgeRuntimeState;
  activeConnectionCount: number | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  heartbeat: NapCatBridgeHeartbeatInfo;
}

export interface DaemonStatusInfo {
  online: boolean;
  host: string;
  port: number;
  status: string;
  source: 'health' | 'recorded' | 'default';
  uptimeSeconds: number | null;
  bridges: {
    napcat: NapCatBridgeStatusInfo;
  };
  error?: string;
}

export interface DaemonLogEntry extends Omit<StructuredLogEntry, 'level' | 'process' | 'outcome'> {
  level: StructuredLogLevel;
  process?: StructuredLogProcess;
  outcome?: StructuredLogOutcome;
  timestamp: string;
  source: string;
}

export interface NapCatMessagePreviewEntry {
  receivedAt: string;
  messageType: 'private' | 'group';
  userId: string;
  groupId?: string;
  selfId?: string;
  messageId?: string;
  textPreview: string;
  mentionedSelf: boolean;
  replyEligible: boolean;
}

export interface DaemonLogsInfo {
  filePath: string;
  entries: DaemonLogEntry[];
  napcatMessages: NapCatMessagePreviewEntry[];
}

export type DaemonControlAction = 'start' | 'restart' | 'stop';

export interface DaemonControlResult {
  success: boolean;
  action: DaemonControlAction;
  message: string;
  status: DaemonStatusInfo;
  embeddedRunning: boolean;
}

export type NetworkDiagnosticTargetKey = 'internet' | 'searchEngine';

export interface NetworkDiagnosticProbeResult {
  key: NetworkDiagnosticTargetKey;
  url: string;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  resolvedProxy: string | null;
}

export interface NetworkDiagnosticResult {
  success: boolean;
  testedAt: string;
  effectiveProxy: string | null;
  error: string | null;
  results: NetworkDiagnosticProbeResult[];
}

export type WebSearchEngine = 'google' | 'duckduckgo' | 'bing';

export interface AppConfig {
  general: {
    language: SupportedLocale;
    theme: 'light' | 'dark' | 'system';
    themePresetId: string;
    autoUpdate: boolean;
    minimizeToTray: boolean;
    closeToTray: boolean;
    startMinimized: boolean;
    quickChatHideOnBlur: boolean;
    autoApproveToolRequests: boolean;
  };
  ui: {
    fontSize: number; // 10-32px
    density: 'compact' | 'comfortable' | 'spacious';
    chatContentPadding: number; // 8-40px
    composerPadding: number; // 4-24px
    messageBubblePaddingX: number; // 8-28px
    messageBubblePaddingY: number; // 6-20px
    messageGap: number; // 8-32px
    companion: {
      enabled: boolean;
      alwaysOnTop: boolean;
      rememberPosition: boolean;
      reduceMotion: boolean;
      openMainWindowOnClick: boolean;
      position: {
        x: number | null;
        y: number | null;
      };
    };
  };
  themes: ThemeConfig;
  network: {
    proxy: {
      enable: boolean;
      type: 'http' | 'https' | 'socks5';
      host: string;
      port: number | null;
      username?: string;
      password?: string;
    };
    webSearch: {
      preferredEngine: WebSearchEngine;
    };
    timeout: number;
    retryAttempts: number;
  };
  security: {
    encryptApikeys: boolean;
    requirePassword: boolean;
    sessionTimeout: number;
    enableLogging: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  keybindings: {
    sendMessage: string; // e.g. "Enter"
    openSettings: string; // e.g. "Cmd+," or "Ctrl+,"
  };
  chat: {
    composer: {
      preferredProviderId: string;
      preferredModel: string;
    };
  };
  memory: {
    enabled: boolean;
    autoSummarize: boolean;
    maxRetrievalCount: number;
    similarThreshold: number;
    embeddingModel: {
      providerId: string;
      providerType: string;
      model: string;
    };
    context: {
      enabled: boolean;
      recentMessageCount: number;
      maxRecentTokens: number;
      maxMessageTokens: number;
      maxIdentityTokens: number;
      summaryTriggerMessages: number;
      summaryRecentMessages: number;
      maxSummaryTokens: number;
      maxMemoryTokens: number;
      maxSkillTokens: number;
    };
    emotion: {
      enabled: boolean;
      injectToSystemPrompt: boolean;
      realtimeAnalysis: boolean;
      minConfidence: number;
      minSampleCount: number;
      windowSize: number;
      halfLifeMinutes: number;
      maxAgeMinutes: number;
      includeNeutral: boolean;
      toolGuard: {
        enabled: boolean;
        minConfidence: number;
        minArousal: number;
        maxValence: number;
        requireApproval: boolean;
        disableAutoTools: boolean;
      };
    };
  };
  continuity: {
    enabled: boolean;
    autoCaptureExplicitFacts: boolean;
    injectToSystemPrompt: boolean;
    maxRetrievedItems: number;
  };
  speech: {
    enabled: boolean;
    providerType: 'openai' | 'whisper-node' | '';
    apiKey: string;
    baseUrl: string;
    downloadBaseUrl: string;
    model: string;
    modelPath: string;
    language: string;
    prompt: string;
  };
  toolModel: {
    providerId: string;
    model: string;
  };
  toolExecution: {
    shellApprovalMode: 'always';
  };
  mcp: {
    enabled: boolean;
    connectOnStartup: boolean;
    allowRemoteServers: boolean;
    defaultApprovalMode: 'always' | 'safe-only' | 'never';
    requestTimeoutMs: number;
    maxConcurrentRequests: number;
  };
  daemon: {
    host: string;
    port: number;
  };
  bridges: {
    napcat: {
      enabled: boolean;
      accessToken: string;
      providerType: string;
      model: string;
      tools: string[];
      requireMention: boolean;
    };
  };
  workflowOptimization: WorkflowOptimizationConfig;
  agent: {
    enabled: boolean;
    systemPrompt: string;
    providerType: string;
    model: string;
    temperature: number;
    maxTokens: number;
    maxIterations: number;
    enableTools: boolean;
    enableMemory: boolean;
  };
}
