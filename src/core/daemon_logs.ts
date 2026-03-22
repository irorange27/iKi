import fs from 'node:fs';
import path from 'node:path';

import type { DaemonLogEntry, DaemonLogsInfo } from '../shared/types/config';
import type { StructuredLogEntry, StructuredLogLevel } from '../shared/types/logging';
import { createLogger, getRuntimeLoggingConfig } from './logger';
import { getUserDataPath } from './platform';

const MAX_BUFFER_ENTRIES = 300;

const logBuffer: DaemonLogEntry[] = [];
const loggerCache = new Map<string, ReturnType<typeof createLogger>>();

const getDefaultLogFilePath = () => path.join(getUserDataPath(), 'logs', 'daemon.log');

const isStructuredLogLevel = (level: unknown): level is StructuredLogLevel =>
  level === 'debug' || level === 'info' || level === 'warn' || level === 'error';

const normalizeModule = (source: string): string => {
  const trimmed = source.trim();
  if (!trimmed) return 'daemon';
  return trimmed.replace(/[^a-zA-Z0-9_.-]+/g, '_');
};

const getModuleLogger = (source: string) => {
  const normalized = normalizeModule(source);
  const cached = loggerCache.get(normalized);
  if (cached) return cached;
  const created = createLogger({
    process: 'daemon',
    module: normalized,
  });
  loggerCache.set(normalized, created);
  return created;
};

const pushToBuffer = (entry: DaemonLogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_BUFFER_ENTRIES);
  }
};

const ensureLogDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const appendLogLine = (filePath: string, entry: StructuredLogEntry) => {
  ensureLogDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
};

const toDaemonLogEntry = (entry: StructuredLogEntry, source?: string): DaemonLogEntry => ({
  ...entry,
  timestamp: entry.ts,
  source: source || entry.module || entry.process,
  message: entry.message || `${entry.event}${entry.outcome ? ` ${entry.outcome}` : ''}`,
});

const record = (
  level: StructuredLogLevel,
  source: string,
  message: string,
  details?: unknown,
  userDataPath?: string
): DaemonLogEntry => {
  const entry = getModuleLogger(source)[level](message, details);
  const daemonEntry = toDaemonLogEntry(entry, source);

  if (!getRuntimeLoggingConfig().enabled) {
    return daemonEntry;
  }

  pushToBuffer(daemonEntry);

  try {
    appendLogLine(
      userDataPath ? path.join(userDataPath, 'logs', 'daemon.log') : getDefaultLogFilePath(),
      entry
    );
  } catch {
    // Best-effort logging only. Keep the in-memory buffer available for diagnostics.
  }

  return daemonEntry;
};

const parseLogLine = (line: string): DaemonLogEntry | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Partial<StructuredLogEntry> &
      Partial<Pick<DaemonLogEntry, 'timestamp' | 'source'>>;

    if (
      typeof parsed.ts === 'string' &&
      isStructuredLogLevel(parsed.level) &&
      typeof parsed.process === 'string' &&
      typeof parsed.module === 'string' &&
      typeof parsed.event === 'string'
    ) {
      return toDaemonLogEntry(parsed as StructuredLogEntry, parsed.source);
    }

    if (
      typeof parsed.timestamp === 'string' &&
      isStructuredLogLevel(parsed.level) &&
      typeof parsed.source === 'string' &&
      typeof parsed.message === 'string'
    ) {
      return {
        ts: parsed.timestamp,
        timestamp: parsed.timestamp,
        schema_version: 1,
        level: parsed.level,
        process: 'daemon',
        module: normalizeModule(parsed.source),
        event: 'legacy.log',
        source: parsed.source,
        message: parsed.message,
      };
    }
  } catch {
    return {
      ts: new Date(0).toISOString(),
      timestamp: new Date(0).toISOString(),
      schema_version: 1,
      level: 'info',
      process: 'daemon',
      module: 'daemon',
      event: 'legacy.log',
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

export const readRecentDaemonLogs = (limit = 120, userDataPath?: string): DaemonLogsInfo => {
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
