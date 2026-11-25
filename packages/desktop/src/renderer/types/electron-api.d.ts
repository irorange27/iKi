import type { ElectronApi } from '../../shared/electron_api';

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
