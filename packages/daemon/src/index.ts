import {
  initLangfuseTracing,
  shutdownLangfuseTracing,
} from '@iki/backend/observability/langfuse';
import { startDaemonServer } from './server';

initLangfuseTracing();

const portEnv = Number(process.env.IKI_DAEMON_PORT || '');
const port = Number.isFinite(portEnv) && portEnv > 0 ? portEnv : undefined;
const host = process.env.IKI_DAEMON_HOST?.trim() || undefined;

const daemonServer = startDaemonServer({ port, host });

void daemonServer.ready.catch(() => {
  process.exitCode = 1;
});

const flushOnExit = () => {
  void shutdownLangfuseTracing();
};
process.once('SIGINT', flushOnExit);
process.once('SIGTERM', flushOnExit);
process.once('beforeExit', flushOnExit);
