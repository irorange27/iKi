import { app, ipcMain } from 'electron';
import path from 'node:path';

import { setConfig, migrateFromJson, getStorePath } from '@iki/store/database';
import { getAppConfig } from '@iki/backend/config';
import { applyAppLoggingConfig, createLogger } from '@iki/core/logger';
import { getMcpManager } from '@iki/backend/mcp';
import { normalizeAppConfig } from '@iki/backend/config/normalize';
import type {
  AppConfig,
  ConfigRuntimeInfo,
  NetworkDiagnosticResult,
} from '@iki/core/types/config';
import { testNetworkConnectivity } from '../services/network/network_diagnostics';
import { applyAppUpdateConfig } from '../services/update/auto_update_service';
import { broadcastToRenderers } from '../utils/ipc_helpers';
import { companionService } from '../services/companion/companion_service';
import { syncCompanionWindowToConfig } from '../windows/companion_window';

let configIpcRegistered = false;
let configMigrationRun = false;
const configLogger = createLogger({ module: 'config_ipc' });

const migrateLegacyConfig = (): void => {
  if (configMigrationRun) return;
  configMigrationRun = true;

  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'app-config.json');
  migrateFromJson(configPath, 'app_config');
};

const loadConfig = () => getAppConfig();

const getRuntimeInfo = (): ConfigRuntimeInfo => {
  const userDataPath = app.getPath('userData');
  return {
    userDataPath,
    storePath: getStorePath(),
  };
};

const saveConfig = (config: unknown): AppConfig => {
  const normalized = normalizeAppConfig(config);
  setConfig('app_config', normalized);
  applyAppLoggingConfig(normalized);
  return normalized;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const isLocalHost = (hostname: string) => LOCAL_HOSTS.has(hostname);

const isRemoteMcpUrl = (baseUrl?: string | null): boolean => {
  if (!baseUrl || !baseUrl.trim()) return false;
  try {
    const url = new URL(baseUrl);
    return !isLocalHost(url.hostname);
  } catch {
    return true;
  }
};

const handleMcpConfigUpdate = async (prevConfig: AppConfig, nextConfig: AppConfig) => {
  const manager = getMcpManager();

  const prevEnabled = Boolean(prevConfig.mcp?.enabled);
  const nextEnabled = Boolean(nextConfig.mcp?.enabled);

  if (prevEnabled && !nextEnabled) {
    await manager.disconnectAll();
    return;
  }

  if (!prevEnabled && nextEnabled && nextConfig.mcp.connectOnStartup) {
    await manager.initialize();
  }

  if (prevEnabled && nextEnabled) {
    if (!prevConfig.mcp.connectOnStartup && nextConfig.mcp.connectOnStartup) {
      await manager.initialize();
    }

    if (prevConfig.mcp.allowRemoteServers && !nextConfig.mcp.allowRemoteServers) {
      const servers = manager.listServers();
      const remoteServers = servers.filter(
        server =>
          (server.transport === 'streamable-http' || server.transport === 'sse') &&
          isRemoteMcpUrl(server.base_url)
      );
      await Promise.allSettled(
        remoteServers.map(async server => manager.disconnectServer(server.id))
      );
    }

    if (prevConfig.mcp.defaultApprovalMode !== nextConfig.mcp.defaultApprovalMode) {
      manager.refreshToolPolicies();
    }
  }
};

const applyCompanionConfigSideEffects = (config: AppConfig): void => {
  try {
    syncCompanionWindowToConfig(config);
  } catch (error) {
    configLogger.warn('Failed to sync companion window after config update', error);
  }

  try {
    companionService.refreshAvailability();
  } catch (error) {
    configLogger.warn('Failed to refresh companion availability after config update', error);
  }
};

export const registerConfigIpc = (): void => {
  if (configIpcRegistered) return;
  configIpcRegistered = true;

  migrateLegacyConfig();

  ipcMain.handle('config:get', () => {
    return loadConfig();
  });

  ipcMain.handle('config:get-runtime-info', () => {
    return getRuntimeInfo();
  });

  ipcMain.handle(
    'config:test-network',
    async (_event, candidate: AppConfig['network']): Promise<NetworkDiagnosticResult> => {
      return testNetworkConnectivity(candidate);
    }
  );

  ipcMain.handle('config:set', async (_event, config) => {
    const prevConfig = getAppConfig();
    const normalized = saveConfig(config);
    applyAppUpdateConfig(normalized);
    applyCompanionConfigSideEffects(normalized);

    const shouldAwaitMcp = Boolean(prevConfig.mcp?.enabled) && !normalized.mcp.enabled;
    const mcpUpdate = handleMcpConfigUpdate(prevConfig, normalized).catch(error => {
      configLogger.warn('Failed to apply MCP config update', error);
    });

    if (shouldAwaitMcp) {
      await mcpUpdate;
    }

    broadcastToRenderers('config:updated', normalized);

    return true;
  });
};
