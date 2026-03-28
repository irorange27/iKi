import type { AppUpdateStatus } from '../../shared/types/update';
import type { ElectronApi } from '../../shared/types/electron_api';

type UpdateStatusChangedHandler = (status: AppUpdateStatus) => void;
type ElectronUpdatesApi = ElectronApi['updates'];
const noop = (): void => undefined;

const getUpdatesApi = (): ElectronUpdatesApi | null => {
  if (typeof window === 'undefined') return null;
  const api = window.electronAPI?.updates;
  if (!api) return null;
  if (typeof api.getStatus !== 'function') return null;
  if (typeof api.check !== 'function') return null;
  if (typeof api.install !== 'function') return null;
  if (typeof api.onStatusChanged !== 'function') return null;
  return api;
};

export const updateService = {
  async getStatus(): Promise<AppUpdateStatus> {
    const api = getUpdatesApi();
    if (!api) {
      throw new Error('window.electronAPI.updates is missing');
    }
    return api.getStatus();
  },
  async check(): Promise<AppUpdateStatus> {
    const api = getUpdatesApi();
    if (!api) {
      throw new Error('window.electronAPI.updates is missing');
    }
    return api.check();
  },
  async install(): Promise<void> {
    const api = getUpdatesApi();
    if (!api) {
      throw new Error('window.electronAPI.updates is missing');
    }
    return api.install();
  },
  onStatusChanged(callback: UpdateStatusChangedHandler): () => void {
    const api = getUpdatesApi();
    if (!api) return noop;
    return api.onStatusChanged(callback);
  },
};
