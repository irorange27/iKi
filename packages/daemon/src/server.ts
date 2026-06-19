import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { wireCoreContext } from '@iki/backend/core_wiring';
import { getAppConfig } from '@iki/backend/config';
import { registerStandardTools } from '@iki/backend/tools';
import { getMcpManager } from '@iki/backend/mcp';
import { createDaemonLogger } from '@iki/backend/daemon_logs';
import { initializeDatabase } from '@iki/backend/db/database';
import { applyAppLoggingConfig, withLogContext } from '@iki/core/logger';
import { getUserDataPath, setPlatformInfo } from '@iki/backend/platform';
import { createChatService } from '@iki/backend/chat_service';
import { createNapCatReverseBridge } from './napcat_adapter';
import { readOrCreateBootstrapToken } from './bootstrap_token';
import { createDaemonRequestHandler } from './server_http';
import {
  ensureNapCatClient,
  type DaemonSocket,
  type DaemonSocketServer,
  type WsSession,
} from './server_shared';
import { configureDaemonWebSockets } from './server_ws';
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '@iki/backend/constants/daemon';
import type { DaemonStatusInfo } from '@iki/core/types/config';

const nodeRequire = createRequire(fileURLToPath(import.meta.url));

const { WebSocketServer } = nodeRequire('ws') as {
  WebSocketServer: new (options: { noServer: boolean }) => DaemonSocketServer;
};

const ensureUserDataDir = () => {
  const userDataPath = getUserDataPath();
  fs.mkdirSync(userDataPath, { recursive: true });
  return userDataPath;
};

const writePortFile = (userDataPath: string, port: number) => {
  const portPath = path.join(userDataPath, 'daemon.port');
  fs.writeFileSync(portPath, String(port), { encoding: 'utf8' });
};

const writeHostFile = (userDataPath: string, host: string) => {
  const hostPath = path.join(userDataPath, 'daemon.host');
  fs.writeFileSync(hostPath, host, { encoding: 'utf8' });
};

export const startDaemonServer = (options?: { port?: number; host?: string }) => {
  return withLogContext({ process: 'daemon' }, () => {
    setPlatformInfo({
      userDataPath: process.env.IKI_USER_DATA_PATH,
      locale: process.env.IKI_LOCALE,
    });

    const userDataPath = ensureUserDataDir();
    const bootstrapToken = readOrCreateBootstrapToken(userDataPath);
    const port = Number.isFinite(options?.port) ? Number(options?.port) : DEFAULT_DAEMON_PORT;
    const host = options?.host?.trim() || DEFAULT_DAEMON_HOST;
    const serverLogger = createDaemonLogger({
      module: 'daemon_server',
      source: 'daemon',
      userDataPath,
    });

    initializeDatabase();
    wireCoreContext();
    applyAppLoggingConfig(getAppConfig());
    registerStandardTools();
    const mcpManager = getMcpManager();
    void mcpManager.initialize();

    const chatService = createChatService();
    const sessions = new Map<number, WsSession>();
    const wsSessions = new Map<DaemonSocket, WsSession>();
    const nextSessionIdRef = { current: 1 };
    const bootstrapTokenRef = { current: bootstrapToken };
    const napcatClientId = ensureNapCatClient();
    const napcatBridge = createNapCatReverseBridge({
      chatService,
      clientId: napcatClientId,
    });
    let startupSettled = false;
    let shuttingDown = false;
    let resolveReady: () => void = () => undefined;
    let rejectReady: (reason?: unknown) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const server = http.createServer(
      createDaemonRequestHandler({
        host,
        port,
        userDataPath,
        bootstrapTokenRef,
        napcatClientId,
        getNapCatBridgeStatus: napcatBridge.getStatus,
        chatService,
        mcpManager,
        sessions,
        logger: serverLogger,
      })
    );

    const wss = new WebSocketServer({ noServer: true });

    const resolveListeningPort = (): number => {
      const address = server.address();
      return typeof address === 'object' && address ? address.port : port;
    };

    const markReady = () => {
      if (startupSettled) return;
      startupSettled = true;
      resolveReady();
    };

    const markFailed = (error: unknown) => {
      if (startupSettled) return;
      startupSettled = true;
      rejectReady(error);
    };

    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      napcatBridge.dispose();

      void (async () => {
        try {
          await new Promise<void>((resolve, reject) => {
            server.close((err?: Error) => (err ? reject(err) : resolve()));
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ERR_SERVER_NOT_RUNNING') {
            serverLogger.event({
              level: 'warn',
              event: 'daemon.server.shutdown',
              outcome: 'degraded',
              error,
              message: 'Failed to close HTTP server cleanly.',
            });
          }
        }

        try {
          await new Promise<void>((resolve, reject) => {
            wss.close((err?: Error) => (err ? reject(err) : resolve()));
          });
        } catch (error) {
          serverLogger.event({
            level: 'warn',
            event: 'daemon.server.shutdown',
            outcome: 'degraded',
            error,
            message: 'Failed to close WebSocket server cleanly.',
          });
        }
      })();
    };

    const started = {
      server,
      wss,
      port,
      host,
      bootstrapToken,
      getRuntimeStatus: (): DaemonStatusInfo => ({
        online: true,
        host,
        port: started.port,
        status: 'ok',
        source: 'health',
        uptimeSeconds: process.uptime(),
        bridges: {
          napcat: napcatBridge.getStatus(),
        },
      }),
      shutdown,
      ready,
    };

    server.on('error', error => {
      if (shuttingDown) return;
      serverLogger.event({
        level: 'error',
        event: startupSettled ? 'daemon.server.runtime' : 'daemon.server.listen',
        outcome: 'failed',
        error,
        message: startupSettled
          ? 'Daemon server encountered a runtime error.'
          : 'Daemon server failed to bind.',
        data: {
          host,
          port: resolveListeningPort(),
        },
      });
      markFailed(error);
      shutdown();
    });

    configureDaemonWebSockets({
      server,
      wss,
      chatService,
      napcatBridge,
      sessions,
      wsSessions,
      nextSessionIdRef,
      logger: serverLogger,
    });

    server.listen(port, host, () => {
      started.port = resolveListeningPort();
      writePortFile(userDataPath, started.port);
      writeHostFile(userDataPath, host);
      serverLogger.event({
        level: 'info',
        event: 'daemon.server.listen',
        outcome: 'succeeded',
        message: `Listening on http://${host}:${started.port}.`,
        data: {
          host,
          port: started.port,
        },
      });
      markReady();
    });

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return started;
  });
};
