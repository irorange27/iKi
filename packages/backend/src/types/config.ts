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

export interface DaemonLogsInfo {
  filePath: string;
  entries: DaemonLogEntry[];
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
    fontSize: number;
    density: 'compact' | 'comfortable' | 'spacious';
    chatContentPadding: number;
    composerPadding: number;
    messageBubblePaddingX: number;
    messageBubblePaddingY: number;
    messageGap: number;
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
    sendMessage: string;
    openSettings: string;
  };
  chat: {
    composer: {
      preferredProviderId: string;
      preferredModel: string;
    };
  };

  context: {
    enabled: boolean;
    maxIdentityTokens: number;
    maxSkillTokens: number;
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
}
