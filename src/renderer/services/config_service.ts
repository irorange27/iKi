import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonControlResult,
  DaemonLogsInfo,
  DaemonStatusInfo,
  NetworkDiagnosticResult,
} from '../../shared/types/config';
import type { ElectronApi } from '../../shared/types/electron_api';
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
  async getDaemonStatus(): Promise<DaemonStatusInfo> {
    const api = requireElectronApiSlice(
      'config',
      ['getDaemonStatus'],
      'window.electronAPI.config.getDaemonStatus is missing'
    );
    return api.getDaemonStatus();
  },
  async getDaemonLogs(limit = 120): Promise<DaemonLogsInfo> {
    const api = requireElectronApiSlice(
      'config',
      ['getDaemonLogs'],
      'window.electronAPI.config.getDaemonLogs is missing'
    );
    return api.getDaemonLogs(limit);
  },
  async controlDaemon(action: DaemonControlAction): Promise<DaemonControlResult> {
    const api = requireElectronApiSlice(
      'config',
      ['controlDaemon'],
      'window.electronAPI.config.controlDaemon is missing'
    );
    return api.controlDaemon(action);
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
