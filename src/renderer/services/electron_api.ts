import type { ElectronApi } from '../../shared/types/electron_api';

export const getElectronAPI = (): ElectronApi => window.electronAPI as ElectronApi;
