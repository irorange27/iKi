import type { ElectronApi } from '@iki/backend/types/electron_api';

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
