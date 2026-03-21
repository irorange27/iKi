import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonControlResult,
  DaemonLogsInfo,
  DaemonStatusInfo,
} from '../../shared/types/config';
import type { ElectronApi } from '../../shared/types/electron_api';

type ConfigUpdatedHandler = (config: AppConfig) => void;

type ElectronConfigApi = ElectronApi['config'];

const getElectronConfigApi = (): ElectronConfigApi | null => {
  if (typeof window === 'undefined') return null;
  const api = window.electronAPI?.config;
  if (!api) return null;
  if (typeof api.get !== 'function') return null;
  if (typeof api.set !== 'function') return null;
  if (typeof api.onUpdated !== 'function') return null;
  return api;
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
  async controlDaemon(action: DaemonControlAction): Promise<DaemonControlResult> {
    const api = getElectronConfigApi();
    if (!api || typeof api.controlDaemon !== 'function') {
      throw new Error('window.electronAPI.config.controlDaemon is missing');
    }
    return api.controlDaemon(action);
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
