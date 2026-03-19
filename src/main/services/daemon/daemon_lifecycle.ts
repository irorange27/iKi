import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { app } from 'electron';

import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '../../../shared/constants/daemon';
import { getAppConfig } from '../../../core/config';
import type { AppConfig } from '../../../shared/types/config';
import { startDaemonServer } from '../../../daemon/server';

export const DAEMON_MODE_ARG = '--iki-daemon';

const HEALTHCHECK_TIMEOUT_MS = 1200;
const HEALTHCHECK_RETRY_MS = 200;
const STARTUP_WAIT_TIMEOUT_MS = 8000;
const SHUTDOWN_GRACE_MS = 1500;

const AUTOSTART_DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);

let managedDaemonProcess: ChildProcess | null = null;
let embeddedDaemon: ReturnType<typeof startDaemonServer> | null = null;
let startPromise: Promise<void> | null = null;

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
  } catch {
    return { host: DEFAULT_DAEMON_HOST, port: DEFAULT_DAEMON_PORT };
  }
};

const resolveDaemonBinding = (): { host: string; port: number } => readConfigDaemonBinding();

type DaemonHealthInfo = {
  ok: boolean;
  host: string;
  port: number;
};

const readDaemonHealth = async (port: number): Promise<DaemonHealthInfo | null> =>
  new Promise(resolve => {
    const req = http.request(
      {
        host: '127.0.0.1',
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
          } catch {
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

const probeDaemonHealth = async (port: number): Promise<boolean> => {
  const health = await readDaemonHealth(port);
  return Boolean(health?.ok);
};

const waitForDaemonHealthy = async (port: number, timeoutMs = STARTUP_WAIT_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeDaemonHealth(port)) return true;
    await sleep(HEALTHCHECK_RETRY_MS);
  }
  return false;
};

const resolveDaemonArgs = (): string[] => {
  if (app.isPackaged) {
    return [DAEMON_MODE_ARG];
  }

  // In dev, prefer current entry script to match the active boot path.
  const currentEntry = process.argv[1];
  if (typeof currentEntry === 'string' && currentEntry.trim()) {
    return [currentEntry, DAEMON_MODE_ARG];
  }

  // Fallback for uncommon launch paths.
  return [path.resolve(app.getAppPath()), DAEMON_MODE_ARG];
};

const buildDaemonEnv = (binding: { host: string; port: number }): NodeJS.ProcessEnv => ({
  ...process.env,
  IKI_USER_DATA_PATH: app.getPath('userData'),
  IKI_LOCALE: app.getLocale(),
  IKI_DAEMON_HOST: binding.host,
  IKI_DAEMON_PORT: String(binding.port),
});

const stopEmbeddedDaemon = () => {
  if (!embeddedDaemon) return;
  try {
    embeddedDaemon.server.close();
    embeddedDaemon.wss.close();
  } catch (error) {
    console.warn('[Daemon] Failed to stop embedded daemon:', error);
  } finally {
    embeddedDaemon = null;
  }
};

const startEmbeddedDaemon = (binding: { host: string; port: number }) => {
  if (embeddedDaemon) return;
  process.env.IKI_USER_DATA_PATH = app.getPath('userData');
  process.env.IKI_LOCALE = app.getLocale();
  process.env.IKI_DAEMON_HOST = binding.host;
  process.env.IKI_DAEMON_PORT = String(binding.port);
  embeddedDaemon = startDaemonServer({ host: binding.host, port: binding.port });
  console.warn(
    `[Daemon] Falling back to embedded daemon on http://${binding.host}:${binding.port}.`
  );
};

export const startDesktopDaemon = async (): Promise<void> => {
  if (process.argv.includes(DAEMON_MODE_ARG)) return;
  if (normalizeBoolEnv(process.env.IKI_DAEMON_AUTOSTART)) {
    console.log('[Daemon] Autostart disabled by IKI_DAEMON_AUTOSTART.');
    return;
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const binding = resolveDaemonBinding();
    const existingHealth = await readDaemonHealth(binding.port);

    if (existingHealth?.ok) {
      if (existingHealth.host === binding.host) {
        console.log(
          `[Daemon] Existing daemon detected on ${binding.host}:${binding.port}, skipping spawn.`
        );
        stopEmbeddedDaemon();
        return;
      }
      console.warn(
        `[Daemon] Port ${binding.port} already in use by daemon host=${existingHealth.host}, but settings host=${binding.host}.`
      );
      console.warn(
        '[Daemon] Close the existing daemon instance first to apply the new host binding.'
      );
      return;
    }

    const daemonArgs = resolveDaemonArgs();
    const child = spawn(process.execPath, daemonArgs, {
      env: buildDaemonEnv(binding),
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });

    managedDaemonProcess = child;

    child.once('error', error => {
      console.warn('[Daemon] Failed to spawn desktop-managed daemon:', error);
    });

    child.stderr?.on('data', chunk => {
      const text = String(chunk || '').trim();
      if (!text) return;
      console.warn(`[Daemon][child] ${text}`);
    });

    child.once('exit', (code, signal) => {
      if (managedDaemonProcess === child) {
        managedDaemonProcess = null;
      }
      if (code === 0 || signal === 'SIGTERM') return;
      console.warn(
        `[Daemon] Desktop-managed daemon exited unexpectedly (code=${code}, signal=${signal}).`
      );
    });

    const healthy = await waitForDaemonHealthy(binding.port);
    if (!healthy) {
      console.warn(
        `[Daemon] Autostarted process not healthy within ${STARTUP_WAIT_TIMEOUT_MS}ms, switching to embedded mode.`
      );
      if (!child.killed) child.kill('SIGTERM');
      if (managedDaemonProcess === child) managedDaemonProcess = null;
      startEmbeddedDaemon(binding);
      return;
    }

    stopEmbeddedDaemon();
    console.log(
      `[Daemon] Desktop-managed daemon ready on http://${binding.host}:${binding.port}.`
    );
  })()
    .catch(error => {
      console.warn('[Daemon] Autostart flow failed:', error);
    })
    .finally(() => {
      startPromise = null;
    });

  return startPromise;
};

export const stopDesktopDaemon = () => {
  startPromise = null;

  const child = managedDaemonProcess;
  managedDaemonProcess = null;
  if (child && !child.killed) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, SHUTDOWN_GRACE_MS);
    timer.unref();
  }

  stopEmbeddedDaemon();
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
