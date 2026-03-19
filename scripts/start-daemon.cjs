#!/usr/bin/env node

const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const electronBinary = require('electron');
const daemonEntry = path.join(__dirname, '..', 'dist', 'daemon', 'index.js');

const APP_NAME = 'iki';

const getDefaultDesktopUserDataPath = () => {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }

  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, APP_NAME);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim();
  return path.join(xdgConfigHome || path.join(os.homedir(), '.config'), APP_NAME);
};

const userDataPath =
  (process.env.IKI_USER_DATA_PATH && process.env.IKI_USER_DATA_PATH.trim()) ||
  getDefaultDesktopUserDataPath();

const child = spawn(electronBinary, [daemonEntry], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    IKI_USER_DATA_PATH: userDataPath,
  },
});

const forwardSignal = signal => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', error => {
  console.error('[Daemon] Failed to launch Electron runtime:', error);
  process.exit(1);
});
