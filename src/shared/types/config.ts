import type { WorkflowOptimizationConfig } from './workflow';

export interface AppConfig {
  general: {
    language: string | 'zh' | 'en';
    theme: 'light' | 'dark' | 'system';
    autoUpdate: boolean;
    minimizeToTray: boolean;
    closeToTray: boolean;
    startMinimized: boolean;
    quickChatHideOnBlur: boolean;
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
  memory: {
    enabled: boolean;
    autoSummarize: boolean;
    maxRetrievalCount: number;
    similarThreshold: number;
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
    model: string;
  };
  toolExecution: {
    shellApprovalMode: 'high-risk' | 'always' | 'never';
    shellHighRiskPatterns: string[];
  };
  mcp: {
    enabled: boolean;
    connectOnStartup: boolean;
    allowRemoteServers: boolean;
    defaultApprovalMode: 'always' | 'safe-only' | 'never';
    requestTimeoutMs: number;
    maxConcurrentRequests: number;
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
