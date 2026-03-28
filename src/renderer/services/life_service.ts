import type {
  LifeOverview,
  LifeOwnerMode,
  LifePushPayload,
  LifeSnapshot,
} from '../../shared/types/life';
import type { ElectronApi } from '../../shared/types/electron_api';
import { getElectronApiSlice, requireElectronApiSlice } from './electron_api';

type ElectronLifeApi = ElectronApi['life'];
const noop = (): void => undefined;

const getLifeApi = (): ElectronLifeApi | null => {
  return getElectronApiSlice('life', ['getOverview']);
};

export const lifeService = {
  async getOverview(limit = 10): Promise<LifeOverview> {
    const api = requireElectronApiSlice(
      'life',
      ['getOverview'],
      'window.electronAPI.life.getOverview is missing'
    );
    return api.getOverview(limit);
  },
  async refresh(): Promise<LifeSnapshot | null> {
    const api = requireElectronApiSlice(
      'life',
      ['refresh'],
      'window.electronAPI.life.refresh is missing'
    );
    return api.refresh();
  },
  async setOwnerMode(mode: LifeOwnerMode, note?: string | null): Promise<LifeSnapshot | null> {
    const api = requireElectronApiSlice(
      'life',
      ['setOwnerMode'],
      'window.electronAPI.life.setOwnerMode is missing'
    );
    return api.setOwnerMode(mode, note);
  },
  async clearOwnerMode(): Promise<LifeSnapshot | null> {
    const api = requireElectronApiSlice(
      'life',
      ['clearOwnerMode'],
      'window.electronAPI.life.clearOwnerMode is missing'
    );
    return api.clearOwnerMode();
  },
  onPush(callback: (payload: LifePushPayload | unknown) => void): () => void {
    const api = getLifeApi();
    if (!api?.onPush) return noop;
    return api.onPush(callback);
  },
};
