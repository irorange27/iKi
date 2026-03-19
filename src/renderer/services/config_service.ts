import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonLogsInfo,
  DaemonStatusInfo,
} from '../../shared/types/config';

type ConfigUpdatedHandler = (config: AppConfig) => void;

type ElectronConfigApi = {
  get: () => Promise<AppConfig>;
  getRuntimeInfo?: () => Promise<ConfigRuntimeInfo>;
  getDaemonStatus?: () => Promise<DaemonStatusInfo>;
  getDaemonLogs?: (limit?: number) => Promise<DaemonLogsInfo>;
  set: (config: AppConfig) => Promise<unknown>;
  onUpdated: (callback: ConfigUpdatedHandler) => void;
};

type WindowWithElectronApi = Window & {
  electronAPI?: {
    config?: ElectronConfigApi;
  };
};

const getWindow = (): WindowWithElectronApi | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window as WindowWithElectronApi;
};

const getElectronConfigApi = (): ElectronConfigApi | null => {
  const api = getWindow()?.electronAPI?.config;
  if (!api) return null;
  if (typeof api.get !== 'function') return null;
  if (typeof api.set !== 'function') return null;
  if (typeof api.onUpdated !== 'function') return null;
  return api as ElectronConfigApi;
};

const noop = (): void => undefined;

export const configService = {
  async get(): Promise<AppConfig> {
    const api = getElectronConfigApi();
    if (!api) {
      throw new Error('window.electronAPI.config is missing');
    }
    return api.get();
  },
  async set(config: AppConfig): Promise<unknown> {
    const api = getElectronConfigApi();
    if (!api) {
      throw new Error('window.electronAPI.config is missing');
    }
    return api.set(config);
  },
  async getRuntimeInfo(): Promise<ConfigRuntimeInfo> {
    const api = getElectronConfigApi();
    if (!api || typeof api.getRuntimeInfo !== 'function') {
      throw new Error('window.electronAPI.config.getRuntimeInfo is missing');
    }
    return api.getRuntimeInfo();
  },
  async getDaemonStatus(): Promise<DaemonStatusInfo> {
    const api = getElectronConfigApi();
    if (!api || typeof api.getDaemonStatus !== 'function') {
      throw new Error('window.electronAPI.config.getDaemonStatus is missing');
    }
    return api.getDaemonStatus();
  },
  async getDaemonLogs(limit = 120): Promise<DaemonLogsInfo> {
    const api = getElectronConfigApi();
    if (!api || typeof api.getDaemonLogs !== 'function') {
      throw new Error('window.electronAPI.config.getDaemonLogs is missing');
    }
    return api.getDaemonLogs(limit);
  },
  onUpdated(callback: ConfigUpdatedHandler): () => void {
    const api = getElectronConfigApi();
    if (!api) {
      console.warn('window.electronAPI.config is missing; config updates are disabled.');
      return noop;
    }
    api.onUpdated(callback);
    return noop;
  },
};
