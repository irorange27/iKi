import type { ElectronApi } from '@iki/harness/types/electron_api';

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
