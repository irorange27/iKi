import type { AppConfig } from '../../shared/types/config';

type ConfigUpdatedHandler = (config: AppConfig) => void;

type ElectronConfigApi = {
  get: () => Promise<AppConfig>;
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

const noop = () => undefined;

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
