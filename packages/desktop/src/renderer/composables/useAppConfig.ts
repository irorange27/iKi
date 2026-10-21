import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '../store/config';
import { createLogger } from '../logger';
import type { AppConfig } from '@iki/backend/types/config';

const appConfigLogger = createLogger({ module: 'app_config' });

export const useAppConfig = () => {
  const store = useConfigStore();
  const { config } = storeToRefs(store);

  
  const initialize = async () => {
    if (!store.initialized) {
      await store.initialize();
    }
  };

  onMounted(async () => {
    await initialize();
  });

  
  const ui = computed(() => config.value?.ui);
  
  const general = computed(() => config.value?.general);
  
  const network = computed(() => config.value?.network);
  
  const security = computed(() => config.value?.security);
  
  const keybindings = computed(() => config.value?.keybindings);
  
  const context = computed(() => config.value?.context);
  
  const toolModel = computed(() => config.value?.toolModel);

  
  const fontSize = computed(() => ui.value?.fontSize ?? 15);
  const density = computed(() => ui.value?.density ?? 'comfortable');
  const theme = computed(() => general.value?.theme ?? 'system');

  let saveTimer: NodeJS.Timeout | null = null;
  const SAVE_DELAY = 300; // 防抖延迟（ms）

  
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await store.saveConfig();
      } catch (error) {
        appConfigLogger.event({
          level: 'error',
          event: 'config.auto_save',
          outcome: 'failed',
          error,
        });
      }
    }, SAVE_DELAY);
  };

  
  const saveNow = async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await store.saveConfig();
  };

  
  const updateUi = <K extends keyof AppConfig['ui']>(key: K, value: AppConfig['ui'][K]) => {
    if (!config.value) return;
    store.updateUi(key, value);
    debouncedSave();
  };

  
  const updateGeneral = <K extends keyof AppConfig['general']>(
    key: K,
    value: AppConfig['general'][K]
  ) => {
    if (!config.value) return;
    store.updateGeneral(key, value);
    debouncedSave();
  };

  
  const updateNetwork = (
    path: string,
    value: AppConfig['network'][keyof AppConfig['network']] | string | number | boolean | null
  ) => {
    if (!config.value) return;
    updateNested(config.value.network, path, value);
    debouncedSave();
  };

  
  const updateSecurity = <K extends keyof AppConfig['security']>(
    key: K,
    value: AppConfig['security'][K]
  ) => {
    if (!config.value) return;
    store.updateSecurity(key, value);
    debouncedSave();
  };

  
  const updateKeybinding = <K extends keyof AppConfig['keybindings']>(key: K, value: string) => {
    if (!config.value) return;
    config.value.keybindings[key] = value;
    debouncedSave();
  };

  
  const updateContext = <K extends keyof AppConfig['context']>(
    key: K,
    value: AppConfig['context'][K]
  ) => {
    if (!config.value) return;
    config.value.context[key] = value;
    debouncedSave();
  };

  
  const updateToolModel = (key: 'model', value: string) => {
    if (!config.value) return;
    config.value.toolModel[key] = value;
    debouncedSave();
  };

  
  const updateNested = (target: Record<string, unknown>, path: string, value: unknown) => {
    const keys = path.split('.');
    let current: Record<string, unknown> = target;
    for (let index = 0; index < keys.length - 1; index++) {
      const key = keys[index];
      if (!(key in current)) {
        appConfigLogger.event({
          level: 'warn',
          event: 'config.update_nested',
          outcome: 'skipped',
          message: `Path ${path} does not exist in target.`,
        });
        return;
      }
      const next = current[key];
      if (!next || typeof next !== 'object') {
        appConfigLogger.event({
          level: 'warn',
          event: 'config.update_nested',
          outcome: 'skipped',
          message: `Path ${path} is not an object path.`,
        });
        return;
      }
      current = next as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = value;
  };

  
  const resetAll = () => {
    store.resetConfig();
  };

  
  const resetSection = async (section: keyof AppConfig) => {
    await store.resetSection(section);
  };

  return {
    config,

    ui,
    general,
    network,
    security,
    keybindings,
    context,
    toolModel,
    fontSize,
    density,
    theme,

    initialize,

    saveNow,
    debouncedSave,

    updateUi,
    updateGeneral,
    updateNetwork,
    updateSecurity,
    updateKeybinding,
    updateContext,
    updateToolModel,

    resetAll,
    resetSection,
  };
};
