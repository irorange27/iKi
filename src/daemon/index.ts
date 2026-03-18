import { startDaemonServer } from './server';

const portEnv = Number(process.env.IKI_DAEMON_PORT || '');
const port = Number.isFinite(portEnv) && portEnv > 0 ? portEnv : undefined;

startDaemonServer({ port });
