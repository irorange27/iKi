import { defineStore } from 'pinia';
import type { AppConfig } from '@iki/backend/types/config';
import { createDefaultAppConfig, mergeAppConfig } from '@iki/backend/config/defaults';
import { clonePlainData } from '@iki/backend/utils/clone';
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
    async initialize() {
      try {
        const saved = await configService.get();
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

      if (!this.initialized) {
        configService.onUpdated((newConfig: AppConfig) => {
          this.config = mergeConfigWithDefaults(newConfig);
        });

        this.initialized = true;
      }
    },

    async saveConfig() {
      const rawConfig = clonePlainData(this.config);
      await configService.set(rawConfig);
    },

    updateUi<K extends keyof AppConfig['ui']>(key: K, value: AppConfig['ui'][K]) {
      this.config.ui[key] = value;
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
