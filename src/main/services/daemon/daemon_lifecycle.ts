import http from 'node:http';
import { app } from 'electron';

import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '../../../shared/constants/daemon';
import { getAppConfig } from '../../../core/config';
import type { AppConfig } from '../../../shared/types/config';
import { createDaemonLogger } from '../../../core/daemon_logs';
import { startDaemonServer } from '../../../daemon/server';

export const DAEMON_MODE_ARG = '--iki-daemon';

const HEALTHCHECK_TIMEOUT_MS = 1200;
const HEALTHCHECK_RETRY_MS = 200;
const STARTUP_WAIT_TIMEOUT_MS = 8000;

const AUTOSTART_DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);

let embeddedDaemon: ReturnType<typeof startDaemonServer> | null = null;
let embeddedBinding: { host: string; port: number } | null = null;
let startPromise: Promise<void> | null = null;

const getDaemonLifecycleLogger = () =>
  createDaemonLogger({
    module: 'daemon_lifecycle',
    source: 'daemon-lifecycle',
    userDataPath: app.getPath('userData'),
  });

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const normalizeBoolEnv = (value: string | undefined): boolean => {
  if (!value) return false;
  return AUTOSTART_DISABLED_VALUES.has(value.trim().toLowerCase());
};

const normalizePort = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < 1 || normalized > 65535) return fallback;
  return normalized;
};

const readConfigDaemonBinding = (): { host: string; port: number } => {
  try {
    const config = getAppConfig();
    const host =
      typeof config.daemon?.host === 'string' && config.daemon.host.trim()
        ? config.daemon.host.trim()
        : DEFAULT_DAEMON_HOST;
    const port = normalizePort(config.daemon?.port, DEFAULT_DAEMON_PORT);
    return { host, port };
  } catch (error) {
    getDaemonLifecycleLogger().event({
      level: 'warn',
      event: 'daemon.lifecycle.config',
      outcome: 'degraded',
      error,
      message: 'Failed to read daemon binding from config; using defaults.',
      data: {
        host: DEFAULT_DAEMON_HOST,
        port: DEFAULT_DAEMON_PORT,
      },
    });
    return { host: DEFAULT_DAEMON_HOST, port: DEFAULT_DAEMON_PORT };
  }
};

const resolveDaemonBinding = (): { host: string; port: number } => readConfigDaemonBinding();

type DaemonHealthInfo = {
  ok: boolean;
  host: string;
  port: number;
};

const resolveHealthProbeHost = (host: string): string => {
  const normalized = host.trim();
  if (!normalized || normalized === '0.0.0.0' || normalized === '::') {
    return '127.0.0.1';
  }
  return normalized;
};

const readDaemonHealth = async (
  port: number,
  probeHost = '127.0.0.1'
): Promise<DaemonHealthInfo | null> =>
  new Promise(resolve => {
    const req = http.request(
      {
        host: probeHost,
        port,
        method: 'GET',
        path: '/v1/health',
        timeout: HEALTHCHECK_TIMEOUT_MS,
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            resolve(null);
            return;
          }
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            const host =
              typeof parsed.host === 'string' && parsed.host.trim()
                ? parsed.host.trim()
                : DEFAULT_DAEMON_HOST;
            const reportedPort = normalizePort(parsed.port, port);
            resolve({ ok: true, host, port: reportedPort });
          } catch (error) {
            getDaemonLifecycleLogger().event({
              level: 'warn',
              event: 'daemon.lifecycle.healthcheck',
              outcome: 'degraded',
              error,
              message: 'Daemon health response was not valid JSON; using fallback binding.',
              data: {
                probe_host: probeHost,
                probe_port: port,
                status,
              },
            });
            resolve({ ok: true, host: DEFAULT_DAEMON_HOST, port });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => resolve(null));
    req.end();
  });

const probeDaemonHealth = async (port: number, probeHost: string): Promise<boolean> => {
  const health = await readDaemonHealth(port, probeHost);
  return Boolean(health?.ok);
};

const waitForDaemonHealthy = async (
  port: number,
  probeHost: string,
  timeoutMs = STARTUP_WAIT_TIMEOUT_MS
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeDaemonHealth(port, probeHost)) return true;
    await sleep(HEALTHCHECK_RETRY_MS);
  }
  return false;
};

const sameBinding = (
  left: { host: string; port: number },
  right: { host: string; port: number }
): boolean => left.host === right.host && left.port === right.port;

const stopEmbeddedDaemon = () => {
  if (!embeddedDaemon) return;
  try {
    embeddedDaemon.shutdown();
  } catch (error) {
    getDaemonLifecycleLogger().event({
      level: 'warn',
      event: 'daemon.lifecycle.stop',
      outcome: 'failed',
      error,
      message: 'Failed to stop embedded daemon.',
    });
  } finally {
    embeddedDaemon = null;
    embeddedBinding = null;
  }
};

const startEmbeddedDaemon = (binding: { host: string; port: number }) => {
  if (embeddedDaemon) return embeddedDaemon;
  process.env.IKI_USER_DATA_PATH = app.getPath('userData');
  process.env.IKI_LOCALE = app.getLocale();
  process.env.IKI_DAEMON_HOST = binding.host;
  process.env.IKI_DAEMON_PORT = String(binding.port);
  embeddedDaemon = startDaemonServer({ host: binding.host, port: binding.port });
  embeddedBinding = binding;
  return embeddedDaemon;
};

export const isDesktopDaemonEmbeddedRunning = (): boolean => Boolean(embeddedDaemon);

export const startDesktopDaemon = async (options?: { ignoreAutostartEnv?: boolean }): Promise<void> => {
  if (process.argv.includes(DAEMON_MODE_ARG)) return;
  if (!options?.ignoreAutostartEnv && normalizeBoolEnv(process.env.IKI_DAEMON_AUTOSTART)) {
    getDaemonLifecycleLogger().event({
      level: 'info',
      event: 'daemon.lifecycle.autostart',
      outcome: 'skipped',
      message: 'Autostart disabled by IKI_DAEMON_AUTOSTART.',
    });
    return;
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const binding = resolveDaemonBinding();
    const probeHost = resolveHealthProbeHost(binding.host);

    if (embeddedBinding && sameBinding(embeddedBinding, binding)) {
      const healthy = await probeDaemonHealth(binding.port, probeHost);
      if (healthy) {
        getDaemonLifecycleLogger().event({
          level: 'info',
          event: 'daemon.lifecycle.start',
          outcome: 'skipped',
          message: `Embedded daemon already running on http://${binding.host}:${binding.port}.`,
          data: {
            host: binding.host,
            port: binding.port,
          },
        });
        return;
      }
      getDaemonLifecycleLogger().event({
        level: 'warn',
        event: 'daemon.lifecycle.healthcheck',
        outcome: 'degraded',
        message: 'Embedded daemon health check failed, restarting.',
        data: {
          host: binding.host,
          port: binding.port,
        },
      });
      stopEmbeddedDaemon();
    } else if (embeddedBinding) {
      getDaemonLifecycleLogger().event({
        level: 'info',
        event: 'daemon.lifecycle.start',
        outcome: 'started',
        message: 'Restarting embedded daemon for updated binding.',
      });
      stopEmbeddedDaemon();
    }

    const existingHealth = await readDaemonHealth(binding.port, probeHost);

    if (existingHealth?.ok) {
      if (existingHealth.host === binding.host) {
        getDaemonLifecycleLogger().event({
          level: 'info',
          event: 'daemon.lifecycle.start',
          outcome: 'skipped',
          message: `Existing daemon detected on ${binding.host}:${binding.port}, skipping embedded startup.`,
          data: {
            host: binding.host,
            port: binding.port,
          },
        });
        return;
      }
      getDaemonLifecycleLogger().event({
        level: 'warn',
        event: 'daemon.lifecycle.binding',
        outcome: 'denied',
        message: `Port ${binding.port} already in use by daemon host=${existingHealth.host}, but settings host=${binding.host}.`,
        data: {
          configured_host: binding.host,
          configured_port: binding.port,
          existing_host: existingHealth.host,
        },
      });
      getDaemonLifecycleLogger().event({
        level: 'warn',
        event: 'daemon.lifecycle.binding',
        outcome: 'denied',
        message: 'Close the existing daemon instance first to apply the new host binding.',
      });
      return;
    }

    const startedDaemon = startEmbeddedDaemon(binding);

    try {
      await startedDaemon.ready;
    } catch (error) {
      getDaemonLifecycleLogger().event({
        level: 'warn',
        event: 'daemon.lifecycle.start',
        outcome: 'failed',
        error,
        message: 'Embedded daemon failed during startup.',
        data: {
          host: binding.host,
          port: binding.port,
        },
      });
      stopEmbeddedDaemon();
      return;
    }

    const healthy = await waitForDaemonHealthy(startedDaemon.port, probeHost);
    if (!healthy) {
      getDaemonLifecycleLogger().event({
        level: 'warn',
        event: 'daemon.lifecycle.healthcheck',
        outcome: 'failed',
        message: `Embedded daemon not healthy within ${STARTUP_WAIT_TIMEOUT_MS}ms; stopping embedded instance.`,
        data: {
          host: binding.host,
          port: binding.port,
          timeout_ms: STARTUP_WAIT_TIMEOUT_MS,
        },
      });
      stopEmbeddedDaemon();
      return;
    }

    getDaemonLifecycleLogger().event({
      level: 'info',
      event: 'daemon.lifecycle.start',
      outcome: 'succeeded',
      message: `Desktop-embedded daemon ready on http://${binding.host}:${binding.port}.`,
      data: {
        host: binding.host,
        port: binding.port,
      },
    });
  })()
    .catch(error => {
      getDaemonLifecycleLogger().event({
        level: 'warn',
        event: 'daemon.lifecycle.autostart',
        outcome: 'failed',
        error,
        message: 'Autostart flow failed.',
      });
    })
    .finally(() => {
      startPromise = null;
    });

  return startPromise;
};

export const stopDesktopDaemon = () => {
  const wasRunning = Boolean(embeddedDaemon);
  startPromise = null;

  stopEmbeddedDaemon();
  return wasRunning;
};

export const restartDesktopDaemon = async (): Promise<void> => {
  stopDesktopDaemon();
  await startDesktopDaemon({ ignoreAutostartEnv: true });
};

const daemonBindingChanged = (prevConfig: AppConfig, nextConfig: AppConfig): boolean => {
  const prevHost = prevConfig.daemon?.host?.trim() || DEFAULT_DAEMON_HOST;
  const nextHost = nextConfig.daemon?.host?.trim() || DEFAULT_DAEMON_HOST;
  const prevPort = normalizePort(prevConfig.daemon?.port, DEFAULT_DAEMON_PORT);
  const nextPort = normalizePort(nextConfig.daemon?.port, DEFAULT_DAEMON_PORT);
  return prevHost !== nextHost || prevPort !== nextPort;
};

export const applyDesktopDaemonConfigUpdate = async (
  prevConfig: AppConfig,
  nextConfig: AppConfig
) => {
  if (process.argv.includes(DAEMON_MODE_ARG)) return;
  if (!daemonBindingChanged(prevConfig, nextConfig)) return;
  stopDesktopDaemon();
  await startDesktopDaemon();
};
