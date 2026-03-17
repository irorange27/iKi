import { defineStore } from 'pinia';
import type { AppConfig } from '../../shared/types/config';
import { configService } from '../services/config_service';

export const DEFAULT_CONFIG: AppConfig = {
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
} as AppConfig;

const mergeConfigWithDefaults = (rawConfig: Partial<AppConfig> | null | undefined): AppConfig => {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(rawConfig || {}),
  } as AppConfig;

  merged.ui = {
    ...DEFAULT_CONFIG.ui,
    ...(rawConfig?.ui || {}),
  };

  merged.general = {
    ...DEFAULT_CONFIG.general,
    ...(rawConfig?.general || {}),
  };

  merged.speech = {
    ...DEFAULT_CONFIG.speech,
    ...(rawConfig?.speech || {}),
  };

  merged.toolExecution = {
    ...DEFAULT_CONFIG.toolExecution,
    ...(rawConfig?.toolExecution || {}),
  };

  return merged;
};

export const useConfigStore = defineStore('config', {
  state: (): { config: AppConfig; initialized: boolean } => ({
    config: DEFAULT_CONFIG,
    initialized: false,
  }),

  actions: {
    // 初始化：从主进程获取动态配置
    async initialize() {
      // 1. Fetch latest config
      try {
        const saved = await configService.get();
        // 合并配置，防止字段缺失
        this.config = mergeConfigWithDefaults(saved as Partial<AppConfig>);
      } catch (error) {
        console.warn('Failed to load config, using defaults:', error);
      }

      // 2. Setup listeners (once)
      if (!this.initialized) {
        // Listen for config updates from main process
        configService.onUpdated((newConfig: AppConfig) => {
          this.config = mergeConfigWithDefaults(newConfig);
        });

        this.initialized = true;
      }
    },

    async saveConfig() {
      // De-proxy config before sending to IPC
      const rawConfig = JSON.parse(JSON.stringify(this.config));
      await configService.set(rawConfig);
    },

    // ✅ 更新UI设置并自动保存
    updateUi<K extends keyof AppConfig['ui']>(key: K, value: AppConfig['ui'][K]) {
      this.config.ui[key] = value;
      // 可选：自动保存
      // this.saveConfig();
    },
    updateGeneral<K extends keyof AppConfig['general']>(key: K, value: AppConfig['general'][K]) {
      this.config.general[key] = value;
    },

    resetConfig() {
      // 重新读取系统配置（获取当前最新系统设置）
      configService.get().then((sysConfig: AppConfig) => {
        this.config = mergeConfigWithDefaults(sysConfig);
      });
    },

    resetSection(section: keyof AppConfig) {
      const defaultSection = JSON.parse(
        JSON.stringify(DEFAULT_CONFIG[section])
      ) as AppConfig[typeof section];
      this.config = {
        ...this.config,
        [section]: defaultSection,
      } as AppConfig;
      this.saveConfig();
    },
  },
});
