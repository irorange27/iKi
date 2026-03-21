import type {
  LifeOverview,
  LifeOwnerMode,
  LifePushPayload,
  LifeSnapshot,
} from '../../shared/types/life';

type ElectronLifeApi = {
  getOverview?: (limit?: number) => Promise<LifeOverview>;
  refresh?: () => Promise<LifeSnapshot | null>;
  setOwnerMode?: (mode: LifeOwnerMode, note?: string | null) => Promise<LifeSnapshot | null>;
  clearOwnerMode?: () => Promise<LifeSnapshot | null>;
  onPush?: (callback: (payload: LifePushPayload | unknown) => void) => void;
  removeAllListeners?: () => void;
};

type WindowWithElectronApi = Window & {
  electronAPI?: {
    life?: ElectronLifeApi;
  };
};

const getWindow = (): WindowWithElectronApi | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window as WindowWithElectronApi;
};

const getLifeApi = (): ElectronLifeApi | null => {
  const api = getWindow()?.electronAPI?.life;
  if (!api || typeof api.getOverview !== 'function') return null;
  return api;
};

export const lifeService = {
  async getOverview(limit = 10): Promise<LifeOverview> {
    const api = getLifeApi();
    if (!api?.getOverview) {
      throw new Error('window.electronAPI.life.getOverview is missing');
    }
    return api.getOverview(limit);
  },
  async refresh(): Promise<LifeSnapshot | null> {
    const api = getLifeApi();
    if (!api?.refresh) {
      throw new Error('window.electronAPI.life.refresh is missing');
    }
    return api.refresh();
  },
  async setOwnerMode(mode: LifeOwnerMode, note?: string | null): Promise<LifeSnapshot | null> {
    const api = getLifeApi();
    if (!api?.setOwnerMode) {
      throw new Error('window.electronAPI.life.setOwnerMode is missing');
    }
    return api.setOwnerMode(mode, note);
  },
  async clearOwnerMode(): Promise<LifeSnapshot | null> {
    const api = getLifeApi();
    if (!api?.clearOwnerMode) {
      throw new Error('window.electronAPI.life.clearOwnerMode is missing');
    }
    return api.clearOwnerMode();
  },
  onPush(callback: (payload: LifePushPayload | unknown) => void): () => void {
    const api = getLifeApi();
    if (!api?.onPush) return () => undefined;
    api.onPush(callback);
    return () => {
      api.removeAllListeners?.();
    };
  },
};
