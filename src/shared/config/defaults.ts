import type { AppConfig } from '../types/config';

export const DEFAULT_APP_CONFIG: AppConfig = {
  general: {
    language: 'en',
    theme: 'system',
    autoUpdate: true,
    minimizeToTray: false,
    closeToTray: false,
    startMinimized: false,
    quickChatHideOnBlur: false,
  },
  ui: {
    fontSize: 15,
    density: 'comfortable',
    chatContentPadding: 24,
    composerPadding: 10,
    messageBubblePaddingX: 16,
    messageBubblePaddingY: 12,
    messageGap: 18,
  },
  network: {
    proxy: {
      enable: false,
      type: 'http',
      host: '',
      port: null,
    },
    timeout: 5000,
    retryAttempts: 3,
  },
  security: {
    encryptApikeys: true,
    requirePassword: false,
    sessionTimeout: 60,
    enableLogging: true,
    logLevel: 'info',
  },
  advanced: {
    enableExperimentalFeatures: false,
    debugMode: false,
    developerMode: false,
  },
  keybindings: {
    sendMessage: 'Enter',
    openSettings: 'Cmd+,',
  },
  memory: {
    enabled: false,
    autoSummarize: false,
    maxRetrievalCount: 5,
    similarThreshold: 0.1,
  },
  speech: {
    enabled: false,
    providerType: 'openai',
    apiKey: '',
    baseUrl: '',
    downloadBaseUrl: '',
    model: 'whisper-1',
    modelPath: '',
    language: '',
    prompt: '',
  },
  toolModel: {
    model: '',
  },
  toolExecution: {
    shellApprovalMode: 'high-risk',
    shellHighRiskPatterns: [],
  },
  agent: {
    enabled: false,
    systemPrompt: 'You are a helpful AI assistant. You are capable, autonomous, and helpful.',
    providerType: '',
    model: '',
    temperature: 0.1,
    maxTokens: 2000,
    maxIterations: 10,
    enableTools: false,
    enableMemory: false,
  },
};

export const createDefaultAppConfig = (): AppConfig =>
  JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG)) as AppConfig;

export const mergeAppConfigWithBase = (
  base: AppConfig,
  rawConfig?: Partial<AppConfig> | null
): AppConfig => {
  if (!rawConfig) return base;

  return {
    ...base,
    ...rawConfig,
    general: {
      ...base.general,
      ...(rawConfig.general ?? {}),
    },
    ui: {
      ...base.ui,
      ...(rawConfig.ui ?? {}),
    },
    network: {
      ...base.network,
      ...(rawConfig.network ?? {}),
      proxy: {
        ...base.network.proxy,
        ...((rawConfig.network ?? {}).proxy ?? {}),
      },
    },
    security: {
      ...base.security,
      ...(rawConfig.security ?? {}),
    },
    advanced: {
      ...base.advanced,
      ...(rawConfig.advanced ?? {}),
    },
    keybindings: {
      ...base.keybindings,
      ...(rawConfig.keybindings ?? {}),
    },
    memory: {
      ...base.memory,
      ...(rawConfig.memory ?? {}),
    },
    speech: {
      ...base.speech,
      ...(rawConfig.speech ?? {}),
    },
    toolModel: {
      ...base.toolModel,
      ...(rawConfig.toolModel ?? {}),
    },
    toolExecution: {
      ...base.toolExecution,
      ...(rawConfig.toolExecution ?? {}),
    },
    agent: {
      ...base.agent,
      ...(rawConfig.agent ?? {}),
    },
  };
};

export const mergeAppConfig = (rawConfig?: Partial<AppConfig> | null): AppConfig =>
  mergeAppConfigWithBase(createDefaultAppConfig(), rawConfig);
