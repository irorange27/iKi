import type { AppConfig } from '../types/config';
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '../constants/daemon';
import { createDefaultThemeConfig } from '../theme/registry';

export const DEFAULT_APP_CONFIG: AppConfig = {
  general: {
    language: 'en',
    theme: 'system',
    themePresetId: 'iki-default',
    autoUpdate: true,
    minimizeToTray: false,
    closeToTray: false,
    startMinimized: false,
    quickChatHideOnBlur: false,
    autoApproveToolRequests: false,
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
  themes: createDefaultThemeConfig(),
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
    context: {
      enabled: true,
      recentMessageCount: 10,
      maxRecentTokens: 2400,
      maxMessageTokens: 420,
      maxIdentityTokens: 320,
      maxRelationshipTokens: 220,
      maxLifeStateTokens: 220,
      maxReflectionTokens: 240,
      summaryTriggerMessages: 14,
      summaryRecentMessages: 6,
      maxSummaryTokens: 500,
      maxMemoryTokens: 500,
      maxSkillTokens: 1200,
    },
    emotion: {
      enabled: true,
      injectToSystemPrompt: true,
      realtimeAnalysis: false,
      minConfidence: 0.45,
      minSampleCount: 2,
      windowSize: 8,
      halfLifeMinutes: 60,
      maxAgeMinutes: 180,
      includeNeutral: false,
      toolGuard: {
        enabled: true,
        minConfidence: 0.6,
        minArousal: 0.6,
        maxValence: -0.2,
        requireApproval: true,
        disableAutoTools: false,
      },
    },
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
    providerType: '',
    model: '',
  },
  toolExecution: {
    shellApprovalMode: 'always',
  },
  mcp: {
    enabled: false,
    connectOnStartup: false,
    allowRemoteServers: false,
    defaultApprovalMode: 'safe-only',
    requestTimeoutMs: 20000,
    maxConcurrentRequests: 4,
  },
  daemon: {
    host: DEFAULT_DAEMON_HOST,
    port: DEFAULT_DAEMON_PORT,
  },
  bridges: {
    napcat: {
      enabled: false,
      accessToken: '',
      providerType: '',
      model: '',
      tools: [],
      requireMention: true,
    },
  },
  workflowOptimization: {
    enabled: true,
    autoPinSkills: true,
    minAutoSkillRuns: 6,
    minSkillSelections: 3,
    pinConfidence: 0.6,
    unpinConfidence: 0.4,
    maxPinnedSkills: 4,
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
    themes: {
      ...base.themes,
      ...(rawConfig.themes ?? {}),
      base46Presets: {
        ...base.themes.base46Presets,
        ...((rawConfig.themes ?? {}).base46Presets ?? {}),
      },
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
      context: {
        ...base.memory.context,
        ...((rawConfig.memory ?? {}).context ?? {}),
      },
      emotion: {
        ...base.memory.emotion,
        ...((rawConfig.memory ?? {}).emotion ?? {}),
        toolGuard: {
          ...base.memory.emotion.toolGuard,
          ...(((rawConfig.memory ?? {}).emotion ?? {}).toolGuard ?? {}),
        },
      },
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
    mcp: {
      ...base.mcp,
      ...(rawConfig.mcp ?? {}),
    },
    daemon: {
      ...base.daemon,
      ...(rawConfig.daemon ?? {}),
    },
    bridges: {
      ...base.bridges,
      ...(rawConfig.bridges ?? {}),
      napcat: {
        ...base.bridges.napcat,
        ...((rawConfig.bridges ?? {}).napcat ?? {}),
      },
    },
    workflowOptimization: {
      ...base.workflowOptimization,
      ...(rawConfig.workflowOptimization ?? {}),
    },
    agent: {
      ...base.agent,
      ...(rawConfig.agent ?? {}),
    },
  };
};

export const mergeAppConfig = (rawConfig?: Partial<AppConfig> | null): AppConfig =>
  mergeAppConfigWithBase(createDefaultAppConfig(), rawConfig);
