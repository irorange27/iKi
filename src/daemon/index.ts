import { startDaemonServer } from './server';

const portEnv = Number(process.env.IKI_DAEMON_PORT || '');
const port = Number.isFinite(portEnv) && portEnv > 0 ? portEnv : undefined;
const host = process.env.IKI_DAEMON_HOST?.trim() || undefined;

startDaemonServer({ port, host });
