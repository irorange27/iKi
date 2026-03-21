import type { ElectronApi } from '../../shared/types/electron_api';

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
