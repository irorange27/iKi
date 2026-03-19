import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

import { setConfig, migrateFromJson } from '../../core/db/database';
import { getAppConfig } from '../../core/config';
import { getMcpManager } from '../../core/mcp';
import { normalizeAppConfig } from '../../shared/config/normalize';
import type { AppConfig } from '../../shared/types/config';

let configIpcRegistered = false;
let configMigrationRun = false;

export const migrateLegacyConfig = (): void => {
  if (configMigrationRun) return;
  configMigrationRun = true;

  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'app-config.json');
  migrateFromJson(configPath, 'app_config');
};

const loadConfig = () => getAppConfig();
const saveConfig = (config: unknown): AppConfig => {
  const normalized = normalizeAppConfig(config);
  setConfig('app_config', normalized);
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

    if (
      prevConfig.mcp.allowRemoteServers &&
      !nextConfig.mcp.allowRemoteServers
    ) {
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

export const registerConfigIpc = (): void => {
  if (configIpcRegistered) return;
  configIpcRegistered = true;

  // Keep migration colocated with config bootstrap so main.ts doesn't have to manage it.
  migrateLegacyConfig();

  ipcMain.handle('config:get', () => {
    return loadConfig();
  });

  ipcMain.handle('config:set', async (_event, config) => {
    const prevConfig = getAppConfig();
    const normalized = saveConfig(config);

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('config:updated', normalized);
    }

    const shouldAwaitMcp = Boolean(prevConfig.mcp?.enabled) && !normalized.mcp.enabled;
    const mcpUpdate = handleMcpConfigUpdate(prevConfig, normalized).catch(error => {
      console.warn('Failed to apply MCP config update', error);
    });

    if (shouldAwaitMcp) {
      await mcpUpdate;
    }
    return true;
  });
};
