import type { AppConfig } from '../../shared/types/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

type ConfigUpdatedHandler = (config: AppConfig) => void;

type ElectronConfigApi = {
  get: () => Promise<AppConfig>;
  set: (config: AppConfig) => Promise<unknown>;
  onUpdated: (callback: ConfigUpdatedHandler) => void;
};

const getWindow = (): any | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window;
};

const getElectronConfigApi = (): ElectronConfigApi | null => {
  const api = getWindow()?.electronAPI?.config;
  if (!api) return null;
  if (typeof api.get !== 'function') return null;
  if (typeof api.set !== 'function') return null;
  if (typeof api.onUpdated !== 'function') return null;
  return api as ElectronConfigApi;
};

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
      return () => {};
    }
    api.onUpdated(callback);
    return () => {};
  },
};
