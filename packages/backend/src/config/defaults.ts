import type { AppConfig, WebSearchEngine } from '../types/config';
import { clonePlainData } from '@iki/backend/utils/clone';
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '@iki/backend/constants/daemon';
import { createDefaultThemeConfig } from '@iki/theme/registry';

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
    companion: {
      enabled: true,
      alwaysOnTop: true,
      rememberPosition: true,
      reduceMotion: false,
      openMainWindowOnClick: true,
      position: {
        x: null,
        y: null,
      },
    },
  },
  themes: createDefaultThemeConfig(),
  network: {
    proxy: {
      enable: false,
      type: 'http',
      host: '',
      port: null,
    },
    webSearch: {
      preferredEngine: 'google',
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
  keybindings: {
    sendMessage: 'Enter',
    openSettings: 'Cmd+,',
  },
  chat: {
    composer: {
      preferredProviderId: '',
      preferredModel: '',
    },
  },
  memory: {
    enabled: false,
    autoSummarize: false,
    maxRetrievalCount: 5,
    similarThreshold: 0.1,
    embeddingModel: {
      providerId: '',
      providerType: '',
      model: '',
    },
    context: {
      enabled: true,
      recentMessageCount: 10,
      maxRecentTokens: 2400,
      maxMessageTokens: 420,
      maxIdentityTokens: 320,
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
  continuity: {
    enabled: true,
    autoCaptureExplicitFacts: true,
    injectToSystemPrompt: true,
    maxRetrievedItems: 6,
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
    providerId: '',
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

export const createDefaultAppConfig = (): AppConfig => clonePlainData(DEFAULT_APP_CONFIG);

const normalizeLegacyWebSearchEngine = (value: unknown): WebSearchEngine | null => {
  if (value === 'google' || value === 'duckduckgo' || value === 'bing') {
    return value;
  }
  return null;
};

export const mergeAppConfigWithBase = (
  base: AppConfig,
  rawConfig?: Partial<AppConfig> | null
): AppConfig => {
  if (!rawConfig) return base;
  const { webSearch: legacyWebSearch, ...restRawConfig } = rawConfig as Partial<AppConfig> & {
    webSearch?: {
      engine?: unknown;
    };
  };
  const legacyPreferredEngine = normalizeLegacyWebSearchEngine(legacyWebSearch?.engine);

  return {
    ...base,
    ...restRawConfig,
    general: {
      ...base.general,
      ...(rawConfig.general ?? {}),
    },
    ui: {
      ...base.ui,
      ...(rawConfig.ui ?? {}),
      companion: {
        ...base.ui.companion,
        ...((rawConfig.ui ?? {}).companion ?? {}),
        position: {
          ...base.ui.companion.position,
          ...(((rawConfig.ui ?? {}).companion ?? {}).position ?? {}),
        },
      },
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
      webSearch: {
        ...base.network.webSearch,
        ...(legacyPreferredEngine ? { preferredEngine: legacyPreferredEngine } : {}),
        ...((rawConfig.network ?? {}).webSearch ?? {}),
      },
    },
    security: {
      ...base.security,
      ...(rawConfig.security ?? {}),
    },
    keybindings: {
      ...base.keybindings,
      ...(rawConfig.keybindings ?? {}),
    },
    chat: {
      ...base.chat,
      ...(rawConfig.chat ?? {}),
      composer: {
        ...base.chat.composer,
        ...((rawConfig.chat ?? {}).composer ?? {}),
      },
    },
    memory: {
      ...base.memory,
      ...(rawConfig.memory ?? {}),
      embeddingModel: {
        ...base.memory.embeddingModel,
        ...((rawConfig.memory ?? {}).embeddingModel ?? {}),
      },
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
    continuity: {
      ...base.continuity,
      ...(rawConfig.continuity ?? {}),
    },
    speech: {
      ...base.speech,
      ...(rawConfig.speech ?? {}),
    },
    toolModel: {
      providerId:
        typeof rawConfig.toolModel?.providerId === 'string'
          ? rawConfig.toolModel.providerId
          : base.toolModel.providerId,
      model:
        typeof rawConfig.toolModel?.model === 'string'
          ? rawConfig.toolModel.model
          : base.toolModel.model,
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
