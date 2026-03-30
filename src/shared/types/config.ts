import type { WorkflowOptimizationConfig } from './workflow';
import type { ThemeConfig } from '../theme/types';
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

export interface DaemonStatusInfo {
  online: boolean;
  host: string;
  port: number;
  status: string;
  source: 'health' | 'recorded' | 'default';
  uptimeSeconds: number | null;
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
  advanced: {
    enableExperimentalFeatures: boolean;
    debugMode: boolean;
    developerMode: boolean;
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
      maxRelationshipTokens: number;
      maxLifeStateTokens: number;
      maxReflectionTokens: number;
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
    providerType: string;
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
