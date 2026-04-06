import type {
  PresenceOverview,
  PresenceOwnerMode,
  PresencePushPayload,
  PresenceSnapshot,
} from '../../shared/types/presence';
import type { ElectronApi } from '../../shared/types/electron_api';
import { getElectronApiSlice, requireElectronApiSlice } from './electron_api';

type ElectronPresenceApi = ElectronApi['presence'];
const noop = (): void => undefined;

const getPresenceApi = (): ElectronPresenceApi | null => {
  return getElectronApiSlice('presence', ['getOverview']);
};

export const presenceService = {
  async getOverview(limit = 10): Promise<PresenceOverview> {
    const api = requireElectronApiSlice(
      'presence',
      ['getOverview'],
      'window.electronAPI.presence.getOverview is missing'
    );
    return api.getOverview(limit);
  },
  async refresh(): Promise<PresenceSnapshot | null> {
    const api = requireElectronApiSlice(
      'presence',
      ['refresh'],
      'window.electronAPI.presence.refresh is missing'
    );
    return api.refresh();
  },
  async setOwnerMode(mode: PresenceOwnerMode, note?: string | null): Promise<PresenceSnapshot | null> {
    const api = requireElectronApiSlice(
      'presence',
      ['setOwnerMode'],
      'window.electronAPI.presence.setOwnerMode is missing'
    );
    return api.setOwnerMode(mode, note);
  },
  async clearOwnerMode(): Promise<PresenceSnapshot | null> {
    const api = requireElectronApiSlice(
      'presence',
      ['clearOwnerMode'],
      'window.electronAPI.presence.clearOwnerMode is missing'
    );
    return api.clearOwnerMode();
  },
  onPush(callback: (payload: PresencePushPayload | unknown) => void): () => void {
    const api = getPresenceApi();
    if (!api?.onPush) return noop;
    return api.onPush(callback);
  },
};
