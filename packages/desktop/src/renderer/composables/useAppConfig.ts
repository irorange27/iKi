import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '../store/config';
import { createLogger } from '../logger';
import type { AppConfig } from '@iki/core/types/config';

const appConfigLogger = createLogger({ module: 'app_config' });

/**
 * 全局配置管理 Composable
 * 提供响应式配置访问、自动保存、类型安全的更新方法
 */
export const useAppConfig = () => {
  const store = useConfigStore();
  const { config } = storeToRefs(store);

  // ==================== 生命周期 ====================

  /**
   * 初始化配置（应用启动时调用一次）
   * 自动从主进程加载持久化配置
   */
  const initialize = async () => {
    if (!store.initialized) {
      await store.initialize();
    }
  };

  // 组件挂载时自动初始化
  onMounted(async () => {
    await initialize();
  });

  // ==================== 计算属性（只读） ====================

  /** UI 配置 */
  const ui = computed(() => config.value?.ui);
  /** 通用配置 */
  const general = computed(() => config.value?.general);
  /** 网络配置 */
  const network = computed(() => config.value?.network);
  /** 安全配置 */
  const security = computed(() => config.value?.security);
  /** 高级配置 */
  const advanced = computed(() => config.value?.advanced);
  /** 快捷键配置 */
  const keybindings = computed(() => config.value?.keybindings);
  /** 记忆配置 */
  const memory = computed(() => config.value?.memory);
  /** 工具模型配置 */
  const toolModel = computed(() => config.value?.toolModel);

  /** 常用快捷属性 */
  const fontSize = computed(() => ui.value?.fontSize ?? 15);
  const density = computed(() => ui.value?.density ?? 'comfortable');
  const theme = computed(() => general.value?.theme ?? 'system');

  // ==================== 自动保存逻辑 ====================

  let saveTimer: NodeJS.Timeout | null = null;
  const SAVE_DELAY = 300; // 防抖延迟（ms）

  /**
   * 防抖自动保存
   * 多次调用会在延迟后合并为一次保存
   */
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

  /** 立即保存（无防抖） */
  const saveNow = async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await store.saveConfig();
  };

  // ==================== 类型安全的更新方法 ====================

  /**
   * 更新 UI 配置
   * @example updateUi('fontSize', 18)
   * @example updateUi('density', 'compact')
   */
  const updateUi = <K extends keyof AppConfig['ui']>(key: K, value: AppConfig['ui'][K]) => {
    if (!config.value) return;
    store.updateUi(key, value);
    debouncedSave();
  };

  /**
   * 更新 General 配置
   * @example updateGeneral('theme', 'dark')
   * @example updateGeneral('autoUpdate', false)
   */
  const updateGeneral = <K extends keyof AppConfig['general']>(
    key: K,
    value: AppConfig['general'][K]
  ) => {
    if (!config.value) return;
    store.updateGeneral(key, value);
    debouncedSave();
  };

  /**
   * 更新 Network 配置
   * @example updateNetwork('timeout', 10000)
   * @example updateNetwork('proxy.enable', true)
   */
  const updateNetwork = (
    path: string,
    value: AppConfig['network'][keyof AppConfig['network']] | string | number | boolean | null
  ) => {
    if (!config.value) return;
    updateNested(config.value.network, path, value);
    debouncedSave();
  };

  /**
   * 更新 Security 配置
   * @example updateSecurity('encryptApiKeys', true)
   */
  const updateSecurity = <K extends keyof AppConfig['security']>(
    key: K,
    value: AppConfig['security'][K]
  ) => {
    if (!config.value) return;
    store.updateSecurity(key, value);
    debouncedSave();
  };

  /**
   * 更新 Advanced 配置
   */
  const updateAdvanced = <K extends keyof AppConfig['advanced']>(
    key: K,
    value: AppConfig['advanced'][K]
  ) => {
    if (!config.value) return;
    store.updateAdvanced(key, value);
    debouncedSave();
  };

  /**
   * 更新 Keybindings 配置
   */
  const updateKeybinding = <K extends keyof AppConfig['keybindings']>(key: K, value: string) => {
    if (!config.value) return;
    config.value.keybindings[key] = value;
    debouncedSave();
  };

  /**
   * 更新 Memory 配置
   */
  const updateMemory = <K extends keyof AppConfig['memory']>(
    key: K,
    value: AppConfig['memory'][K]
  ) => {
    if (!config.value) return;
    config.value.memory[key] = value;
    debouncedSave();
  };

  /**
   * 更新 ToolModel 配置
   */
  const updateToolModel = (key: 'model', value: string) => {
    if (!config.value) return;
    config.value.toolModel[key] = value;
    debouncedSave();
  };

  // ==================== 私有工具方法 ====================

  /**
   * 嵌套对象更新（内部使用）
   * @example updateNested(obj, 'proxy.host', '127.0.0.1')
   */
  const updateNested = (
    target: Record<string, unknown>,
    path: string,
    value: unknown
  ) => {
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

  // ==================== 重置方法 ====================

  /** 重置所有配置到默认值 */
  const resetAll = () => {
    store.resetConfig();
  };

  /**
   * 重置指定模块
   * @example resetSection('ui')  // 仅重置 UI 设置
   * @example resetSection('network')  // 重置网络设置
   */
  const resetSection = async (section: keyof AppConfig) => {
    await store.resetSection(section);
  };

  // ==================== 返回值 ====================

  return {
    // 配置对象
    config,

    // 计算属性（只读）
    ui,
    general,
    network,
    security,
    advanced,
    keybindings,
    memory,
    toolModel,
    fontSize,
    density,
    theme,

    // 生命周期
    initialize,

    // 保存
    saveNow,
    debouncedSave,

    // 更新方法（类型安全）
    updateUi,
    updateGeneral,
    updateNetwork,
    updateSecurity,
    updateAdvanced,
    updateKeybinding,
    updateMemory,
    updateToolModel,

    // 重置
    resetAll,
    resetSection,
  };
};
