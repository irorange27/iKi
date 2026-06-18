import { defineStore } from 'pinia';
import type { AppConfig } from '@iki/core/types/config';
import { createDefaultAppConfig, mergeAppConfig } from '@iki/backend/config/defaults';
import { clonePlainData } from '@iki/core/utils/clone';
import { createLogger } from '../logger';
import { configService } from '../services/config_service';

const mergeConfigWithDefaults = (rawConfig: Partial<AppConfig> | null | undefined): AppConfig =>
  mergeAppConfig(rawConfig ?? null);
const configStoreLogger = createLogger({ module: 'config_store' });

export const useConfigStore = defineStore('config', {
  state: (): { config: AppConfig; initialized: boolean } => ({
    config: createDefaultAppConfig(),
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
        configStoreLogger.event({
          level: 'warn',
          event: 'config.load',
          outcome: 'degraded',
          error,
          message: 'Failed to load config; using defaults.',
          fallback_applied: true,
        });
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
      const rawConfig = clonePlainData(this.config);
      await configService.set(rawConfig);
    },

    updateUi<K extends keyof AppConfig['ui']>(key: K, value: AppConfig['ui'][K]) {
      this.config.ui[key] = value;
      // NOTE: persistence is handled by useAppConfig composable's debouncedSave().
      // Callers that bypass the composable must trigger save themselves.
    },
    updateGeneral<K extends keyof AppConfig['general']>(key: K, value: AppConfig['general'][K]) {
      this.config.general[key] = value;
    },
    setToolModel(value: AppConfig['toolModel']) {
      this.config.toolModel = {
        ...value,
      };
    },
    updateToolExecution<K extends keyof AppConfig['toolExecution']>(
      key: K,
      value: AppConfig['toolExecution'][K]
    ) {
      this.config.toolExecution[key] = value;
    },
    updateNetwork<K extends Exclude<keyof AppConfig['network'], 'proxy' | 'webSearch'>>(
      key: K,
      value: AppConfig['network'][K]
    ) {
      this.config.network[key] = value;
    },
    updateNetworkProxy<K extends keyof AppConfig['network']['proxy']>(
      key: K,
      value: AppConfig['network']['proxy'][K]
    ) {
      this.config.network.proxy[key] = value;
    },
    updateNetworkWebSearch<K extends keyof AppConfig['network']['webSearch']>(
      key: K,
      value: AppConfig['network']['webSearch'][K]
    ) {
      this.config.network.webSearch[key] = value;
    },
    updateSecurity<K extends keyof AppConfig['security']>(
      key: K,
      value: AppConfig['security'][K]
    ) {
      this.config.security[key] = value;
    },
    updateAdvanced<K extends keyof AppConfig['advanced']>(
      key: K,
      value: AppConfig['advanced'][K]
    ) {
      this.config.advanced[key] = value;
    },
    updateKeybinding<K extends keyof AppConfig['keybindings']>(
      key: K,
      value: AppConfig['keybindings'][K]
    ) {
      this.config.keybindings[key] = value;
    },
    setChatComposerSelection(value: AppConfig['chat']['composer']) {
      this.config.chat.composer = {
        ...value,
      };
    },

    async resetConfig() {
      try {
        const sysConfig = await configService.get();
        this.config = mergeConfigWithDefaults(sysConfig);
      } catch (error: unknown) {
        configStoreLogger.event({
          level: 'error',
          event: 'config.reset',
          outcome: 'failed',
          error,
          message: 'Failed to reset config from system.',
        });
      }
    },

    async resetSection(section: keyof AppConfig) {
      const defaultSection = createDefaultAppConfig()[section];
      this.config = {
        ...this.config,
        [section]: defaultSection,
      } as AppConfig;
      await this.saveConfig();
    },
  },
});
