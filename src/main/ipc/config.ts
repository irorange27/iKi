import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { setConfig, migrateFromJson } from '../../core/db/database';
import { getAppConfig } from '../../core/config';
import { readRecentDaemonLogs } from '../../core/daemon_logs';
import { getMcpManager } from '../../core/mcp';
import { normalizeAppConfig } from '../../shared/config/normalize';
import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonLogsInfo,
  DaemonStatusInfo,
} from '../../shared/types/config';
import { applyDesktopDaemonConfigUpdate } from '../services/daemon/daemon_lifecycle';
import {
  buildNapCatWsUrl,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  NAPCAT_REVERSE_WS_PATH,
} from '../../shared/constants/daemon';

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

const readOptionalTextFile = (filePath: string): string | null => {
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
};

const resolveDaemonHost = (config: AppConfig): string => {
  const rawHost = config.daemon?.host;
  if (typeof rawHost !== 'string' || !rawHost.trim()) return DEFAULT_DAEMON_HOST;
  return rawHost.trim();
};

const resolveDaemonPort = (config: AppConfig): number => {
  const rawPort = config.daemon?.port;
  if (!Number.isFinite(rawPort)) return DEFAULT_DAEMON_PORT;
  const parsed = Math.trunc(rawPort);
  if (parsed < 1 || parsed > 65535) return DEFAULT_DAEMON_PORT;
  return parsed;
};

const readRecordedDaemonLocation = (userDataPath: string, config: AppConfig) => {
  const recordedHost = readOptionalTextFile(path.join(userDataPath, 'daemon.host'));
  const recordedPort = readOptionalTextFile(path.join(userDataPath, 'daemon.port'));

  const configuredHost = resolveDaemonHost(config);
  const configuredPort = resolveDaemonPort(config);
  const parsedPort = Number(recordedPort || '');

  return {
    host: recordedHost || configuredHost,
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : configuredPort,
    source: (recordedHost || recordedPort ? 'recorded' : 'default') as 'recorded' | 'default',
  };
};

const requestDaemonHealth = (port: number): Promise<{ statusCode: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/health',
        timeout: 1000,
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Daemon health check timed out'));
    });
    req.on('error', reject);
  });

const getDaemonStatus = async (): Promise<DaemonStatusInfo> => {
  const userDataPath = app.getPath('userData');
  const config = loadConfig();
  const recorded = readRecordedDaemonLocation(userDataPath, config);

  try {
    const health = await requestDaemonHealth(recorded.port);
    if (health.statusCode !== 200) {
      return {
        online: false,
        host: recorded.host,
        port: recorded.port,
        status: 'offline',
        source: recorded.source,
        uptimeSeconds: null,
        error: `Health check returned HTTP ${health.statusCode}`,
      };
    }

    const payload = JSON.parse(health.body) as {
      host?: string;
      port?: number;
      status?: string;
      uptime?: number;
    };

    return {
      online: true,
      host: typeof payload.host === 'string' && payload.host.trim() ? payload.host : recorded.host,
      port: typeof payload.port === 'number' && Number.isFinite(payload.port) ? payload.port : recorded.port,
      status: typeof payload.status === 'string' && payload.status.trim() ? payload.status : 'ok',
      source: 'health',
      uptimeSeconds:
        typeof payload.uptime === 'number' && Number.isFinite(payload.uptime) ? payload.uptime : null,
    };
  } catch (error) {
    return {
      online: false,
      host: recorded.host,
      port: recorded.port,
      status: 'offline',
      source: recorded.source,
      uptimeSeconds: null,
      error: error instanceof Error ? error.message : 'Failed to contact daemon',
    };
  }
};

const getRuntimeInfo = (): ConfigRuntimeInfo => {
  const userDataPath = app.getPath('userData');
  const config = loadConfig();
  const configuredHost = resolveDaemonHost(config);
  const configuredPort = resolveDaemonPort(config);
  return {
    userDataPath,
    dbPath: path.join(userDataPath, 'iKi_v0.db'),
    daemon: {
      defaultHost: DEFAULT_DAEMON_HOST,
      defaultPort: DEFAULT_DAEMON_PORT,
      configuredHost,
      configuredPort,
      napcatWsPath: NAPCAT_REVERSE_WS_PATH,
      localNapCatWsUrl: buildNapCatWsUrl(configuredHost, configuredPort),
      dockerNapCatWsUrl: buildNapCatWsUrl('host.docker.internal', configuredPort),
    },
  };
};

const getDaemonLogs = (limit = 120): DaemonLogsInfo => {
  const userDataPath = app.getPath('userData');
  const parsedLimit = Number(limit);
  const normalizedLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.trunc(parsedLimit), 500) : 120;
  return readRecentDaemonLogs(normalizedLimit, userDataPath);
};

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

  ipcMain.handle('config:get-runtime-info', () => {
    return getRuntimeInfo();
  });

  ipcMain.handle('config:get-daemon-status', async () => {
    return getDaemonStatus();
  });

  ipcMain.handle('config:get-daemon-logs', (_event, limit?: number) => {
    return getDaemonLogs(limit);
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
    const daemonUpdate = applyDesktopDaemonConfigUpdate(prevConfig, normalized).catch(error => {
      console.warn('Failed to apply daemon config update', error);
    });

    if (shouldAwaitMcp) {
      await mcpUpdate;
      await daemonUpdate;
    }
    return true;
  });
};
