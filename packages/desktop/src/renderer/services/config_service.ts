import type {
  AppConfig,
  ConfigRuntimeInfo,
  NetworkDiagnosticResult,
} from '@iki/backend/types/config';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../logger';
import { getElectronApiSlice, requireElectronApiSlice } from './electron_api';

type ConfigUpdatedHandler = (config: AppConfig) => void;

type ElectronConfigApi = ElectronApi['config'];
const configServiceLogger = createLogger({ module: 'config_service' });

const getElectronConfigApi = (): ElectronConfigApi | null => {
  return getElectronApiSlice('config', ['get', 'set', 'onUpdated']);
};

const noop = (): void => undefined;

export const configService = {
  async get(): Promise<AppConfig> {
    const api = requireElectronApiSlice('config', ['get'], 'window.electronAPI.config is missing');
    return api.get();
  },
  async set(config: AppConfig): Promise<unknown> {
    const api = requireElectronApiSlice('config', ['set'], 'window.electronAPI.config is missing');
    return api.set(config);
  },
  async getRuntimeInfo(): Promise<ConfigRuntimeInfo> {
    const api = requireElectronApiSlice(
      'config',
      ['getRuntimeInfo'],
      'window.electronAPI.config.getRuntimeInfo is missing'
    );
    return api.getRuntimeInfo();
  },
  async testNetwork(network: AppConfig['network']): Promise<NetworkDiagnosticResult> {
    const api = requireElectronApiSlice(
      'config',
      ['testNetwork'],
      'window.electronAPI.config.testNetwork is missing'
    );
    return api.testNetwork(network);
  },
  onUpdated(callback: ConfigUpdatedHandler): () => void {
    const api = getElectronConfigApi();
    if (!api) {
      configServiceLogger.event({
        level: 'warn',
        event: 'config.subscription',
        outcome: 'skipped',
        message: 'window.electronAPI.config is missing; config updates are disabled.',
      });
      return noop;
    }
    return api.onUpdated(callback);
  },
};
