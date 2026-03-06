import { defineStore } from 'pinia';
import type { AppConfig } from '../../shared/types/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

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
    autoRetrieve: false,
    maxRetrievalCount: 5,
    similarThreshold: 0.1,
  },
  toolModel: {
    model: '',
  },
} as AppConfig;

export const useConfigStore = defineStore('config', {
  state: (): { config: AppConfig; initialized: boolean } => ({
    config: DEFAULT_CONFIG,
    initialized: false,
  }),

  actions: {
    // 初始化：从主进程获取动态配置
    async initialize() {
      if (!window.electronAPI) {
        console.error(
          'CRITICAL: window.electronAPI is missing! Preload script may not have loaded.'
        );
        return;
      }

      // 1. Fetch latest config
      try {
        const saved = await window.electronAPI.config.get();
        // 合并配置，防止字段缺失
        this.config = { ...DEFAULT_CONFIG, ...saved };
        this.applyCssVariables();
      } catch (error) {
        console.warn('Failed to load config, using defaults:', error);
      }

      // 2. Setup listeners (once)
      if (!this.initialized) {
        // Listen for config updates from main process
        window.electronAPI.config.onUpdated((newConfig: AppConfig) => {
          this.config = newConfig;
          this.applyCssVariables();
        });

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (this.config.general.theme === 'system') {
            this.applyCssVariables();
          }
        });

        this.initialized = true;
      }
    },

    async saveConfig() {
      // De-proxy config before sending to IPC
      const rawConfig = JSON.parse(JSON.stringify(this.config));
      await window.electronAPI.config.set(rawConfig);
    },

    // ✅ 更新UI设置并自动保存
    updateUi<K extends keyof AppConfig['ui']>(key: K, value: AppConfig['ui'][K]) {
      this.config.ui[key] = value;
      this.applyCssVariables();
      // 可选：自动保存
      // this.saveConfig();
    },
    updateGeneral<K extends keyof AppConfig['general']>(key: K, value: AppConfig['general'][K]) {
      this.config.general[key] = value;
      if (key === 'theme') {
        this.applyCssVariables();
      }
    },
    applyCssVariables() {
      const { fontSize, density } = this.config.ui;
      const { theme: configTheme } = this.config.general;

      // Resolve 'system' theme
      let resolvedTheme = configTheme;
      if (configTheme === 'system') {
        resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      }

      const root = document.documentElement;
      root.style.setProperty('--font-size', `${fontSize}px`);
      root.setAttribute('data-density', density);
      root.setAttribute('data-theme', resolvedTheme);
    },

    resetConfig() {
      // 重新读取系统配置（获取当前最新系统设置）
      window.electronAPI.config.get().then((sysConfig: AppConfig) => {
        this.config = sysConfig;
        this.applyCssVariables();
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
      if (section === 'ui' || section === 'general') {
        this.applyCssVariables();
      }
      this.saveConfig();
    },
  },
});
