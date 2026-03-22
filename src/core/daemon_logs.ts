import fs from 'node:fs';
import path from 'node:path';

import type {
  DaemonLogEntry,
  DaemonLogsInfo,
  NapCatMessagePreviewEntry,
} from '../shared/types/config';
import type {
  StructuredLogEntry,
  StructuredLogLevel,
  StructuredLogOutcome,
} from '../shared/types/logging';
import {
  createStructuredLogEntry,
  getRuntimeLoggingConfig,
  sanitizeLogData,
  writeStructuredLogEntry,
} from './logger';
import { getUserDataPath } from './platform';

const MAX_BUFFER_ENTRIES = 300;
const MAX_NAPCAT_MESSAGE_PREVIEWS = 80;
const MAX_PREVIEW_TEXT_BYTES = 280;

const logBuffer: DaemonLogEntry[] = [];
const napcatPreviewBuffer: NapCatMessagePreviewEntry[] = [];

type DaemonLoggerOptions = {
  module: string;
  source?: string;
  userDataPath?: string;
};

type DaemonLogEventInput = {
  level: StructuredLogLevel;
  event: string;
  outcome?: StructuredLogOutcome;
  message?: string;
  trace_id?: string;
  request_id?: string;
  session_id?: string;
  duration_ms?: number;
  entity?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: unknown;
  retryable?: boolean;
  fallback_applied?: boolean;
};

type DaemonLogger = {
  debug: (message: string, details?: unknown) => DaemonLogEntry;
  info: (message: string, details?: unknown) => DaemonLogEntry;
  warn: (message: string, details?: unknown) => DaemonLogEntry;
  error: (message: string, details?: unknown) => DaemonLogEntry;
  event: (input: DaemonLogEventInput) => DaemonLogEntry;
};

const getDefaultLogFilePath = () => path.join(getUserDataPath(), 'logs', 'daemon.log');
const getDefaultNapCatPreviewFilePath = () =>
  path.join(getUserDataPath(), 'logs', 'napcat-preview.json');

const isStructuredLogLevel = (level: unknown): level is StructuredLogLevel =>
  level === 'debug' || level === 'info' || level === 'warn' || level === 'error';

const normalizeModule = (source: string): string => {
  const trimmed = source.trim();
  if (!trimmed) return 'daemon';
  return trimmed.replace(/[^a-zA-Z0-9_.-]+/g, '_');
};

const pushToBuffer = (entry: DaemonLogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_BUFFER_ENTRIES);
  }
};

const pushPreviewToBuffer = (entry: NapCatMessagePreviewEntry) => {
  napcatPreviewBuffer.push(entry);
  if (napcatPreviewBuffer.length > MAX_NAPCAT_MESSAGE_PREVIEWS) {
    napcatPreviewBuffer.splice(0, napcatPreviewBuffer.length - MAX_NAPCAT_MESSAGE_PREVIEWS);
  }
};

const ensureLogDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const truncateUtf8 = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;

  let result = '';
  for (const char of value) {
    const candidate = result + char;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) break;
    result = candidate;
  }

  return `${result}[TRUNCATED]`;
};

const appendLogLine = (filePath: string, entry: StructuredLogEntry) => {
  ensureLogDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
};

const writePreviewFile = (filePath: string, entries: NapCatMessagePreviewEntry[]) => {
  ensureLogDir(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(entries), { encoding: 'utf8' });
  fs.renameSync(tempPath, filePath);
};

const toDaemonLogEntry = (entry: StructuredLogEntry, source?: string): DaemonLogEntry => ({
  ...entry,
  timestamp: entry.ts,
  source: source || entry.module || entry.process,
  message: entry.message || `${entry.event}${entry.outcome ? ` ${entry.outcome}` : ''}`,
});

const writeDaemonEntry = (
  entry: StructuredLogEntry,
  source: string,
  userDataPath?: string
): DaemonLogEntry => {
  const daemonEntry = toDaemonLogEntry(entry, source);

  if (!getRuntimeLoggingConfig().enabled) {
    return daemonEntry;
  }

  writeStructuredLogEntry(entry);
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

const toLegacyData = (details: unknown): Record<string, unknown> | undefined => {
  if (!details || typeof details !== 'object' || Array.isArray(details) || details instanceof Error) {
    return undefined;
  }
  return sanitizeLogData(details as Record<string, unknown>);
};

const normalizeId = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return truncateUtf8(value.trim(), 64);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const normalizePreviewTimestamp = (value: unknown): string => {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
};

const normalizeNapCatPreviewEntry = (
  entry: NapCatMessagePreviewEntry
): NapCatMessagePreviewEntry | null => {
  const textPreview = truncateUtf8(
    String(sanitizeLogData(entry.textPreview ?? '') || '')
      .replace(/\s+/g, ' ')
      .trim(),
    MAX_PREVIEW_TEXT_BYTES
  );
  const userId = normalizeId(entry.userId);
  if (!textPreview || !userId) return null;

  return {
    receivedAt: normalizePreviewTimestamp(entry.receivedAt),
    messageType: entry.messageType === 'group' ? 'group' : 'private',
    userId,
    ...(normalizeId(entry.groupId) ? { groupId: normalizeId(entry.groupId) } : {}),
    ...(normalizeId(entry.selfId) ? { selfId: normalizeId(entry.selfId) } : {}),
    ...(normalizeId(entry.messageId) ? { messageId: normalizeId(entry.messageId) } : {}),
    textPreview,
    mentionedSelf: Boolean(entry.mentionedSelf),
    replyEligible: Boolean(entry.replyEligible),
  };
};

const parseNapCatPreviewFile = (raw: string): NapCatMessagePreviewEntry[] => {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(item =>
      item && typeof item === 'object'
        ? normalizeNapCatPreviewEntry(item as NapCatMessagePreviewEntry)
        : null
    )
    .filter((entry): entry is NapCatMessagePreviewEntry => Boolean(entry));
};

export const createDaemonLogger = (options: DaemonLoggerOptions): DaemonLogger => {
  const module = normalizeModule(options.module);
  const source = options.source?.trim() || options.module.trim() || module;

  const event = (input: DaemonLogEventInput): DaemonLogEntry => {
    const entry = createStructuredLogEntry(
      {
        process: 'daemon',
        module,
      },
      input
    );
    return writeDaemonEntry(entry, source, options.userDataPath);
  };

  const createLegacyMethod =
    (level: StructuredLogLevel) =>
    (message: string, details?: unknown): DaemonLogEntry =>
      event({
        level,
        event: 'legacy.log',
        message,
        ...(details instanceof Error ? { error: details } : {}),
        ...(toLegacyData(details) ? { data: toLegacyData(details) } : {}),
      });

  return {
    debug: createLegacyMethod('debug'),
    info: createLegacyMethod('info'),
    warn: createLegacyMethod('warn'),
    error: createLegacyMethod('error'),
    event,
  };
};

export const recordNapCatMessagePreview = (
  entry: NapCatMessagePreviewEntry,
  userDataPath?: string
): NapCatMessagePreviewEntry | null => {
  const normalized = normalizeNapCatPreviewEntry(entry);
  if (!normalized) return null;

  pushPreviewToBuffer(normalized);

  try {
    writePreviewFile(
      userDataPath
        ? path.join(userDataPath, 'logs', 'napcat-preview.json')
        : getDefaultNapCatPreviewFilePath(),
      napcatPreviewBuffer
    );
  } catch {
    // Best-effort preview persistence only. Keep the in-memory buffer available for diagnostics.
  }

  return normalized;
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

export const getNapCatPreviewFilePath = (userDataPath?: string): string =>
  userDataPath ? path.join(userDataPath, 'logs', 'napcat-preview.json') : getDefaultNapCatPreviewFilePath();

export const readRecentNapCatMessagePreviews = (
  limit = 20,
  userDataPath?: string
): NapCatMessagePreviewEntry[] => {
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.trunc(limit), MAX_NAPCAT_MESSAGE_PREVIEWS)
      : 20;
  const filePath = getNapCatPreviewFilePath(userDataPath);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseNapCatPreviewFile(raw).slice(-normalizedLimit);
  } catch {
    return napcatPreviewBuffer.slice(-normalizedLimit);
  }
};

export const daemonLog = {
  debug: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    createDaemonLogger({ module: source, source, userDataPath }).debug(message, details),
  info: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    createDaemonLogger({ module: source, source, userDataPath }).info(message, details),
  warn: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    createDaemonLogger({ module: source, source, userDataPath }).warn(message, details),
  error: (source: string, message: string, details?: unknown, userDataPath?: string) =>
    createDaemonLogger({ module: source, source, userDataPath }).error(message, details),
};

export const readRecentDaemonLogs = (limit = 120, userDataPath?: string): DaemonLogsInfo => {
  const filePath = getDaemonLogFilePath(userDataPath);
  const napcatMessages = readRecentNapCatMessagePreviews(limit, userDataPath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entries = raw
      .split(/\r?\n/)
      .map(parseLogLine)
      .filter((entry): entry is DaemonLogEntry => Boolean(entry));

    return {
      filePath,
      entries: entries.slice(-Math.max(1, limit)),
      napcatMessages,
    };
  } catch {
    return {
      filePath,
      entries: logBuffer.slice(-Math.max(1, limit)),
      napcatMessages,
    };
  }
};
