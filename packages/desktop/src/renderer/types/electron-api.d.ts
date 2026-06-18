import type { ElectronApi } from '@iki/core/types/electron_api';

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
