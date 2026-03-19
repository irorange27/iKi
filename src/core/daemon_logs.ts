import fs from 'node:fs';
import path from 'node:path';

import type { DaemonLogEntry, DaemonLogsInfo } from '../shared/types/config';
import { logger } from './logger';
import { getUserDataPath } from './platform';

type DaemonLogLevel = DaemonLogEntry['level'];

const MAX_BUFFER_ENTRIES = 300;

const logBuffer: DaemonLogEntry[] = [];

const getDefaultLogFilePath = () => path.join(getUserDataPath(), 'logs', 'daemon.log');

const pushToBuffer = (entry: DaemonLogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_BUFFER_ENTRIES);
  }
};

const ensureLogDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const toLogMessage = (message: string, details?: unknown): string => {
  if (details === undefined) return message;
  if (details instanceof Error) {
    return `${message} ${details.stack || details.message}`;
  }
  if (typeof details === 'string') return `${message} ${details}`;
  try {
    return `${message} ${JSON.stringify(details)}`;
  } catch {
    return `${message} ${String(details)}`;
  }
};

const appendLogLine = (filePath: string, entry: DaemonLogEntry) => {
  ensureLogDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
};

const forwardToLogger = (level: DaemonLogLevel, source: string, message: string) => {
  const line = `[${source}] ${message}`;
  if (level === 'error') {
    logger.error(line);
    return;
  }
  if (level === 'warn') {
    logger.warn(line);
    return;
  }
  if (level === 'debug') {
    logger.debug(line);
    return;
  }
  logger.info(line);
};

const record = (
  level: DaemonLogLevel,
  source: string,
  message: string,
  details?: unknown,
  userDataPath?: string
): DaemonLogEntry => {
  const entry: DaemonLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message: toLogMessage(message, details),
  };

  pushToBuffer(entry);

  try {
    appendLogLine(
      userDataPath ? path.join(userDataPath, 'logs', 'daemon.log') : getDefaultLogFilePath(),
      entry
    );
  } catch {
    // Best-effort logging only. Keep the in-memory buffer available for diagnostics.
  }

  forwardToLogger(level, source, entry.message);
  return entry;
};

const parseLogLine = (line: string): DaemonLogEntry | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Partial<DaemonLogEntry>;
    if (
      typeof parsed.timestamp === 'string' &&
      (parsed.level === 'debug' ||
        parsed.level === 'info' ||
        parsed.level === 'warn' ||
        parsed.level === 'error') &&
      typeof parsed.source === 'string' &&
      typeof parsed.message === 'string'
    ) {
      return {
        timestamp: parsed.timestamp,
        level: parsed.level,
        source: parsed.source,
        message: parsed.message,
      };
    }
  } catch {
    return {
      timestamp: new Date(0).toISOString(),
      level: 'info',
      source: 'daemon',
      message: trimmed,
    };
  }

  return null;
};

export const getDaemonLogFilePath = (userDataPath?: string): string =>
  userDataPath ? path.join(userDataPath, 'logs', 'daemon.log') : getDefaultLogFilePath();

export const daemonLog = {
  debug: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    record('debug', source, message, details, userDataPath),
  info: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    record('info', source, message, details, userDataPath),
  warn: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    record('warn', source, message, details, userDataPath),
  error: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    record('error', source, message, details, userDataPath),
};

export const readRecentDaemonLogs = (
  limit = 120,
  userDataPath?: string
): DaemonLogsInfo => {
  const filePath = getDaemonLogFilePath(userDataPath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entries = raw
      .split(/\r?\n/)
      .map(parseLogLine)
      .filter((entry): entry is DaemonLogEntry => Boolean(entry));

    return {
      filePath,
      entries: entries.slice(-Math.max(1, limit)),
    };
  } catch {
    return {
      filePath,
      entries: logBuffer.slice(-Math.max(1, limit)),
    };
  }
};
