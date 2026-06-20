import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { setConfig, migrateFromJson } from '@iki/backend/db/database';
import { getAppConfig } from '@iki/backend/config';
import { readRecentDaemonLogs } from '@iki/backend/daemon_logs';
import { applyAppLoggingConfig, createLogger } from '@iki/backend/logger';
import { getMcpManager } from '@iki/backend/mcp';
import { normalizeAppConfig } from '@iki/backend/config/normalize';
import type {
  AppConfig,
  ConfigRuntimeInfo,
  DaemonControlAction,
  DaemonControlResult,
  DaemonLogsInfo,
  DaemonStatusInfo,
  NapCatBridgeHeartbeatInfo,
  NapCatBridgeStatusInfo,
  NetworkDiagnosticResult,
} from '@iki/backend/types/config';
import {
  applyDesktopDaemonConfigUpdate,
  getDesktopEmbeddedDaemonStatus,
  isDesktopDaemonEmbeddedRunning,
  restartDesktopDaemon,
  startDesktopDaemon,
  stopDesktopDaemon,
} from '../services/daemon/daemon_lifecycle';
import { testNetworkConnectivity } from '../services/network/network_diagnostics';
import { applyAppUpdateConfig } from '../services/update/auto_update_service';
import {
  buildNapCatWsUrl,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  NAPCAT_REVERSE_WS_PATH,
} from '@iki/backend/constants/daemon';
import { getAllBrowserWindows } from '../utils/browser_windows';
import { companionService } from '../services/companion/companion_service';
import { syncCompanionWindowToConfig } from '../windows/companion_window';

let configIpcRegistered = false;
let configMigrationRun = false;
const configLogger = createLogger({ module: 'config_ipc' });

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

const buildFallbackNapCatHeartbeatStatus = (): NapCatBridgeHeartbeatInfo => ({
  lastReceivedAt: null,
  intervalMs: null,
  ageMs: null,
  online: null,
  good: null,
  stale: null,
});

const buildFallbackNapCatBridgeStatus = (config: AppConfig): NapCatBridgeStatusInfo => ({
  state: config.bridges?.napcat?.enabled ? 'unknown' : 'disabled',
  activeConnectionCount: null,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  heartbeat: buildFallbackNapCatHeartbeatStatus(),
});

const normalizeOptionalIsoTimestamp = (value: unknown, fallback: string | null): string | null => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeNapCatHeartbeatStatus = (
  value: unknown,
  fallback: NapCatBridgeHeartbeatInfo
): NapCatBridgeHeartbeatInfo => {
  if (!value || typeof value !== 'object') return fallback;

  const lastReceivedAt = Reflect.get(value, 'lastReceivedAt');
  const intervalMs = Reflect.get(value, 'intervalMs');
  const ageMs = Reflect.get(value, 'ageMs');
  const online = Reflect.get(value, 'online');
  const good = Reflect.get(value, 'good');
  const stale = Reflect.get(value, 'stale');

  return {
    lastReceivedAt:
      typeof lastReceivedAt === 'string' && lastReceivedAt.trim() ? lastReceivedAt : null,
    intervalMs:
      typeof intervalMs === 'number' && Number.isFinite(intervalMs) && intervalMs >= 0
        ? Math.trunc(intervalMs)
        : fallback.intervalMs,
    ageMs:
      typeof ageMs === 'number' && Number.isFinite(ageMs) && ageMs >= 0 ? Math.trunc(ageMs) : null,
    online: typeof online === 'boolean' ? online : null,
    good: typeof good === 'boolean' ? good : null,
    stale: typeof stale === 'boolean' ? stale : null,
  };
};

const normalizeNapCatBridgeStatus = (
  value: unknown,
  fallback: NapCatBridgeStatusInfo
): NapCatBridgeStatusInfo => {
  if (!value || typeof value !== 'object') return fallback;

  const rawState = Reflect.get(value, 'state');
  const state =
    rawState === 'disabled' ||
    rawState === 'disconnected' ||
    rawState === 'degraded' ||
    rawState === 'connected' ||
    rawState === 'unknown'
      ? rawState
      : fallback.state;
  const rawCount = Reflect.get(value, 'activeConnectionCount');
  const activeConnectionCount =
    typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount >= 0
      ? Math.trunc(rawCount)
      : fallback.activeConnectionCount;
  const lastConnectedAt = normalizeOptionalIsoTimestamp(
    Reflect.get(value, 'lastConnectedAt'),
    fallback.lastConnectedAt
  );
  const lastDisconnectedAt = normalizeOptionalIsoTimestamp(
    Reflect.get(value, 'lastDisconnectedAt'),
    fallback.lastDisconnectedAt
  );
  const heartbeat = normalizeNapCatHeartbeatStatus(
    Reflect.get(value, 'heartbeat'),
    fallback.heartbeat
  );

  return {
    state,
    activeConnectionCount,
    lastConnectedAt,
    lastDisconnectedAt,
    heartbeat,
  };
};

const getDaemonStatus = async (): Promise<DaemonStatusInfo> => {
  const userDataPath = app.getPath('userData');
  const config = loadConfig();
  const recorded = readRecordedDaemonLocation(userDataPath, config);
  const fallbackNapCatBridgeStatus = buildFallbackNapCatBridgeStatus(config);
  const embeddedStatus = getDesktopEmbeddedDaemonStatus();

  if (embeddedStatus) {
    return {
      ...embeddedStatus,
      host: embeddedStatus.host || recorded.host,
      port: Number.isFinite(embeddedStatus.port) ? embeddedStatus.port : recorded.port,
      bridges: {
        napcat: normalizeNapCatBridgeStatus(
          embeddedStatus.bridges?.napcat,
          fallbackNapCatBridgeStatus
        ),
      },
    };
  }

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
        bridges: {
          napcat: fallbackNapCatBridgeStatus,
        },
        error: `Health check returned HTTP ${health.statusCode}`,
      };
    }

    const payload = JSON.parse(health.body) as {
      host?: string;
      port?: number;
      status?: string;
      uptime?: number;
      bridges?: {
        napcat?: unknown;
      };
    };

    return {
      online: true,
      host: typeof payload.host === 'string' && payload.host.trim() ? payload.host : recorded.host,
      port:
        typeof payload.port === 'number' && Number.isFinite(payload.port)
          ? payload.port
          : recorded.port,
      status: typeof payload.status === 'string' && payload.status.trim() ? payload.status : 'ok',
      source: 'health',
      uptimeSeconds:
        typeof payload.uptime === 'number' && Number.isFinite(payload.uptime)
          ? payload.uptime
          : null,
      bridges: {
        napcat: normalizeNapCatBridgeStatus(payload.bridges?.napcat, fallbackNapCatBridgeStatus),
      },
    };
  } catch (error) {
    return {
      online: false,
      host: recorded.host,
      port: recorded.port,
      status: 'offline',
      source: recorded.source,
      uptimeSeconds: null,
      bridges: {
        napcat: fallbackNapCatBridgeStatus,
      },
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

const controlDesktopDaemon = async (action: DaemonControlAction): Promise<DaemonControlResult> => {
  if (action === 'start') {
    await startDesktopDaemon({ ignoreAutostartEnv: true });
  } else if (action === 'restart') {
    await restartDesktopDaemon();
  } else {
    stopDesktopDaemon();
  }

  const status = await getDaemonStatus();
  const embeddedRunning = isDesktopDaemonEmbeddedRunning();

  if (action === 'stop') {
    if (!status.online) {
      return {
        success: true,
        action,
        message: 'Desktop-managed daemon stopped.',
        status,
        embeddedRunning,
      };
    }

    return {
      success: false,
      action,
      message: 'Embedded daemon stopped, but another daemon is still responding on this port.',
      status,
      embeddedRunning,
    };
  }

  if (status.online) {
    return {
      success: true,
      action,
      message:
        action === 'start'
          ? `Daemon is online at ${status.host}:${status.port}.`
          : `Daemon restarted and is online at ${status.host}:${status.port}.`,
      status,
      embeddedRunning,
    };
  }

  return {
    success: false,
    action,
    message: 'Daemon did not become healthy. Check Recent Logs for details.',
    status,
    embeddedRunning,
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

  ipcMain.handle('config:control-daemon', async (_event, action: DaemonControlAction) => {
    if (action !== 'start' && action !== 'restart' && action !== 'stop') {
      throw new Error(`Unsupported daemon action: ${String(action)}`);
    }
    return controlDesktopDaemon(action);
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
    const daemonUpdate = applyDesktopDaemonConfigUpdate(prevConfig, normalized).catch(error => {
      configLogger.warn('Failed to apply daemon config update', error);
    });

    if (shouldAwaitMcp) {
      await mcpUpdate;
      await daemonUpdate;
    }

    for (const win of getAllBrowserWindows()) {
      try {
        win.webContents.send('config:updated', normalized);
      } catch {
        // window may have been destroyed since enumeration
      }
    }

    return true;
  });
};
