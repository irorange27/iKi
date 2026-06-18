import type { AppUpdateStatus } from '@iki/core/types/update';
import type { ElectronApi } from '@iki/core/types/electron_api';
import { getElectronApiSlice, requireElectronApiSlice } from './electron_api';

type UpdateStatusChangedHandler = (status: AppUpdateStatus) => void;
type ElectronUpdatesApi = ElectronApi['updates'];
const noop = (): void => undefined;

const getUpdatesApi = (): ElectronUpdatesApi | null => {
  return getElectronApiSlice('updates', ['getStatus', 'check', 'install', 'onStatusChanged']);
};

export const updateService = {
  async getStatus(): Promise<AppUpdateStatus> {
    const api = requireElectronApiSlice(
      'updates',
      ['getStatus'],
      'window.electronAPI.updates is missing'
    );
    return api.getStatus();
  },
  async check(): Promise<AppUpdateStatus> {
    const api = requireElectronApiSlice(
      'updates',
      ['check'],
      'window.electronAPI.updates is missing'
    );
    return api.check();
  },
  async install(): Promise<void> {
    const api = requireElectronApiSlice(
      'updates',
      ['install'],
      'window.electronAPI.updates is missing'
    );
    return api.install();
  },
  onStatusChanged(callback: UpdateStatusChangedHandler): () => void {
    const api = getUpdatesApi();
    if (!api) return noop;
    return api.onStatusChanged(callback);
  },
};
