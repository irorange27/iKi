import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import winston from 'winston';

import type { AppConfig } from './types/config';
import type {
  StructuredLogEntry,
  StructuredLogError,
  StructuredLogLevel,
  StructuredLogOutcome,
  StructuredLogProcess,
} from './types/logging';
import {
  formatStructuredConsoleLine,
  type StructuredConsoleFormatterInput,
} from './logging/console_formatter';
import { getUserDataPath } from './context/platform_provider';

type LogContext = {
  process?: StructuredLogProcess;
  trace_id?: string;
  request_id?: string;
  session_id?: string;
  entity?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

type LogEventInput = {
  level: StructuredLogLevel;
  event?: string;
  outcome?: StructuredLogOutcome;
  process?: StructuredLogProcess;
  trace_id?: string;
  request_id?: string;
  session_id?: string;
  duration_ms?: number;
  entity?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: unknown;
  message?: string;
  retryable?: boolean;
  fallback_applied?: boolean;
};

type ModuleLoggerOptions = {
  module: string;
  process?: StructuredLogProcess;
};

type LogMethod = (message: unknown, details?: unknown) => StructuredLogEntry;

type ModuleLogger = {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  event: (input: LogEventInput) => StructuredLogEntry;
  span: (input: Omit<LogEventInput, 'duration_ms' | 'outcome'> & { event: string }) => {
    started: StructuredLogEntry;
    succeed: (
      extra?: Omit<LogEventInput, 'level' | 'event' | 'duration_ms' | 'outcome'>
    ) => StructuredLogEntry;
    fail: (
      error: unknown,
      extra?: Omit<LogEventInput, 'level' | 'event' | 'duration_ms' | 'outcome' | 'error'>
    ) => StructuredLogEntry;
  };
};

type RuntimeLoggingConfig = {
  enabled: boolean;
  level: StructuredLogLevel;
};

const SCHEMA_VERSION = 1 as const;
const LEGACY_EVENT = 'legacy.log';
const MAX_STRING_BYTES = 1024;
const MAX_STACK_BYTES = 8192;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_DEPTH = 5;
const MAX_ERROR_CAUSE_DEPTH = 3;
const REDACTED_VALUE = '[REDACTED]';
const OMITTED_VALUE = '[OMITTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';

const REDACTED_KEY_PATTERN = /(token|secret|authorization|cookie|password|credential|api[-_]?key)/i;

const winstonJsonLine = winston.format.printf(info => JSON.stringify(stripWinstonFields(info)));

const contextStorage = new AsyncLocalStorage<LogContext>();

let baseContext: LogContext = {
  process: detectProcessKind(),
};

const runtimeConfig: RuntimeLoggingConfig = {
  enabled: !isTestEnvironment(),
  level: normalizeLogLevel(process.env.LOG_LEVEL) || 'debug',
};

let sinkLogger: winston.Logger | null = null;
let configuredLogDirectory: string | null | undefined;

function isTestEnvironment(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function detectProcessKind(): StructuredLogProcess {
  const processType = (process as NodeJS.Process & { type?: string }).type;
  const windowRef = globalThis as typeof globalThis & { window?: unknown };
  if (process.env.IKI_LOG_PROCESS === 'renderer') return 'renderer';
  if (process.env.IKI_LOG_PROCESS === 'preload') return 'preload';
  if (process.env.IKI_LOG_PROCESS === 'main') return 'main';
  if (process.env.IKI_LOG_PROCESS === 'daemon') return 'daemon';
  if (process.argv.includes('--iki-daemon')) return 'daemon';
  if (processType === 'renderer') {
    return typeof windowRef.window === 'undefined' ? 'preload' : 'renderer';
  }
  return 'main';
}

function normalizeLogLevel(level: unknown): StructuredLogLevel | null {
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }
  if (typeof level !== 'string') return null;
  const normalized = level.trim().toLowerCase();
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error'
  ) {
    return normalized;
  }
  return null;
}

function truncateString(value: string, maxBytes = MAX_STRING_BYTES): string {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes <= maxBytes) return value;

  let result = '';
  for (const char of value) {
    const candidate = result + char;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) break;
    result = candidate;
  }
  return `${result}${TRUNCATED_VALUE}`;
}

function mergeRecords(
  base: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!base && !extra) return undefined;
  return {
    ...(base || {}),
    ...(extra || {}),
  };
}

function shouldRedactKey(key: string): boolean {
  if (key === 'trace_id' || key === 'request_id' || key === 'session_id') return false;
  return REDACTED_KEY_PATTERN.test(key);
}

function sanitizeUnknown(
  value: unknown,
  options?: {
    depth?: number;
    seen?: WeakSet<object>;
    path?: string[];
    maxStringBytes?: number;
  }
): unknown {
  const depth = options?.depth ?? 0;
  const seen = options?.seen ?? new WeakSet<object>();
  const path = options?.path ?? [];
  const maxStringBytes = options?.maxStringBytes ?? MAX_STRING_BYTES;

  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateString(value, maxStringBytes);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return truncateString(value.toString(), maxStringBytes);
  if (typeof value === 'symbol') return truncateString(String(value), maxStringBytes);
  if (typeof value === 'function') return OMITTED_VALUE;

  if (value instanceof Error) {
    return normalizeError(value);
  }

  if (depth >= MAX_OBJECT_DEPTH) {
    return TRUNCATED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item =>
      sanitizeUnknown(item, {
        depth: depth + 1,
        seen,
        path,
        maxStringBytes,
      })
    );
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactKey(key)) {
        output[key] = REDACTED_VALUE;
        continue;
      }
      output[key] = sanitizeUnknown(entry, {
        depth: depth + 1,
        seen,
        path: [...path, key],
        maxStringBytes,
      });
    }
    return output;
  }

  return truncateString(String(value), maxStringBytes);
}

function normalizeError(error: unknown, depth = 0): StructuredLogError | undefined {
  if (error === null || error === undefined) return undefined;
  if (depth >= MAX_ERROR_CAUSE_DEPTH) {
    return { message: TRUNCATED_VALUE };
  }

  if (error instanceof Error) {
    const cause =
      'cause' in error
        ? normalizeError((error as Error & { cause?: unknown }).cause, depth + 1)
        : undefined;

    const code =
      typeof (error as Error & { code?: unknown }).code === 'string'
        ? (error as Error & { code?: string }).code
        : undefined;

    return {
      ...(error.name ? { name: truncateString(error.name) } : {}),
      message: truncateString(error.message || 'Unknown error'),
      ...(code ? { code: truncateString(code) } : {}),
      ...(error.stack
        ? {
            stack: truncateString(error.stack, MAX_STACK_BYTES),
          }
        : {}),
      ...(cause ? { cause } : {}),
    };
  }

  if (typeof error === 'string') {
    return { message: truncateString(error) };
  }

  if (typeof error === 'object') {
    const sanitized = sanitizeUnknown(error);
    if (typeof sanitized === 'object' && sanitized !== null) {
      const record = sanitized as Record<string, unknown>;
      const cause =
        record.cause !== undefined
          ? normalizeError(record.cause, depth + 1) || truncateString(String(record.cause))
          : undefined;
      return {
        ...(typeof record.name === 'string' ? { name: truncateString(record.name) } : {}),
        message:
          typeof record.message === 'string'
            ? truncateString(record.message)
            : truncateString(JSON.stringify(record)),
        ...(typeof record.code === 'string' ? { code: truncateString(record.code) } : {}),
        ...(typeof record.stack === 'string'
          ? { stack: truncateString(record.stack, MAX_STACK_BYTES) }
          : {}),
        ...(cause ? { cause } : {}),
      };
    }
  }

  return { message: truncateString(String(error)) };
}

function deriveMessage(entry: Pick<StructuredLogEntry, 'event' | 'outcome' | 'message'>): string {
  if (entry.message && entry.message.trim()) return truncateString(entry.message.trim());
  return truncateString([entry.event, entry.outcome].filter(Boolean).join(' '));
}

function resolveLogDirectory(): string | null {
  const candidates = [
    process.env.IKI_LOG_DIR,
    path.join(getUserDataPath(), 'logs'),
    path.resolve(process.cwd(), 'logs'),
    path.join(os.tmpdir(), 'iki-logs'),
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      // try the next fallback
    }
  }

  return null;
}

function stripWinstonFields(info: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (key === 'message' || key === 'level') {
      output[key] = value;
      continue;
    }
    if (key.startsWith('Symbol(')) continue;
    output[key] = value;
  }
  return output;
}

function shouldUseAnsiColors(): boolean {
  const forceColor = process.env.FORCE_COLOR;
  if (forceColor === '0') return false;
  if (typeof process.env.NO_COLOR === 'string') return false;
  if (forceColor && forceColor !== 'false') return true;
  return Boolean(process.stdout?.isTTY || process.stderr?.isTTY);
}

function buildConsoleTransport(): winston.transport {
  return new winston.transports.Console({
    stderrLevels: ['error'],
    format: winston.format.printf(info =>
      formatStructuredConsoleLine(stripWinstonFields(info) as StructuredConsoleFormatterInput, {
        colorize: shouldUseAnsiColors(),
      })
    ),
  });
}

function buildFileTransport(filename: string, level?: StructuredLogLevel): winston.transport {
  return new winston.transports.File({
    filename,
    level,
    maxsize: 5242880,
    maxFiles: 5,
    format: winstonJsonLine,
  });
}

function getSinkLogger(): winston.Logger {
  if (sinkLogger) return sinkLogger;
  sinkLogger = winston.createLogger({
    levels: winston.config.npm.levels,
    level: runtimeConfig.level,
    transports: [],
  });
  return sinkLogger;
}

function ensureSinkTransports(): winston.Logger {
  const logger = getSinkLogger();
  logger.level = runtimeConfig.level;
  const logDirectory = resolveLogDirectory();
  if (configuredLogDirectory === logDirectory && logger.transports.length > 0) {
    return logger;
  }

  logger.clear();
  logger.add(buildConsoleTransport());
  if (logDirectory) {
    logger.add(buildFileTransport(path.join(logDirectory, 'combined.log')));
    logger.add(buildFileTransport(path.join(logDirectory, 'error.log'), 'error'));
  }
  configuredLogDirectory = logDirectory;
  return logger;
}

function resolveProcess(
  inputProcess: StructuredLogProcess | undefined,
  context: LogContext,
  defaultProcess: StructuredLogProcess | undefined
): StructuredLogProcess {
  return inputProcess || defaultProcess || context.process || detectProcessKind();
}

function toPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const sanitized = sanitizeUnknown(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : undefined;
}

function emitStructuredLog(entry: StructuredLogEntry): StructuredLogEntry {
  if (!runtimeConfig.enabled) return entry;
  const winstonLogger = ensureSinkTransports();
  winstonLogger.log({
    ...entry,
    level: entry.level,
    message: deriveMessage(entry),
  });
  return entry;
}

function buildLogEntry(
  options: ModuleLoggerOptions,
  input: LogEventInput,
  legacyDetails?: unknown
): StructuredLogEntry {
  const context = getLogContext();
  const error = input.error ?? (legacyDetails instanceof Error ? legacyDetails : undefined);
  const detailData =
    legacyDetails !== undefined && !(legacyDetails instanceof Error)
      ? toPlainRecord(legacyDetails)
      : undefined;
  const data = mergeRecords(mergeRecords(context.data, input.data), detailData);
  const entity = mergeRecords(context.entity, input.entity);

  const entry: StructuredLogEntry = {
    ts: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    level: input.level,
    process: resolveProcess(input.process, context, options.process),
    module: options.module,
    event: input.event || LEGACY_EVENT,
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.trace_id || context.trace_id ? { trace_id: input.trace_id || context.trace_id } : {}),
    ...(input.request_id || context.request_id
      ? { request_id: input.request_id || context.request_id }
      : {}),
    ...(input.session_id || context.session_id
      ? { session_id: input.session_id || context.session_id }
      : {}),
    ...(typeof input.duration_ms === 'number' ? { duration_ms: input.duration_ms } : {}),
    ...(entity && Object.keys(entity).length > 0 ? { entity } : {}),
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
    ...(input.message ? { message: truncateString(input.message, MAX_STACK_BYTES) } : {}),
    ...(normalizeError(error) ? { error: normalizeError(error) } : {}),
    ...(typeof input.retryable === 'boolean' ? { retryable: input.retryable } : {}),
    ...(typeof input.fallback_applied === 'boolean'
      ? { fallback_applied: input.fallback_applied }
      : {}),
  };

  return entry;
}

function createLegacyMethod(level: StructuredLogLevel, options: ModuleLoggerOptions): LogMethod {
  return (message: unknown, details?: unknown) => {
    const text =
      typeof message === 'string'
        ? message
        : message instanceof Error
          ? message.message
          : truncateString(String(message), MAX_STACK_BYTES);

    return emitStructuredLog(
      buildLogEntry(
        options,
        {
          level,
          event: LEGACY_EVENT,
          message: text,
        },
        details
      )
    );
  };
}

export const createLogger = (options: ModuleLoggerOptions): ModuleLogger => {
  const normalizedOptions: ModuleLoggerOptions = {
    ...options,
    module: options.module.trim() || 'app',
  };

  return {
    debug: createLegacyMethod('debug', normalizedOptions),
    info: createLegacyMethod('info', normalizedOptions),
    warn: createLegacyMethod('warn', normalizedOptions),
    error: createLegacyMethod('error', normalizedOptions),
    event: input => emitStructuredLog(buildLogEntry(normalizedOptions, input)),
    span: input => {
      const startedAt = Date.now();
      const started = emitStructuredLog(
        buildLogEntry(normalizedOptions, {
          ...input,
          level: input.level,
          outcome: 'started',
        })
      );

      return {
        started,
        succeed: extra =>
          emitStructuredLog(
            buildLogEntry(normalizedOptions, {
              ...input,
              ...(extra || {}),
              level: input.level,
              outcome: 'succeeded',
              duration_ms: Date.now() - startedAt,
            })
          ),
        fail: (error, extra) =>
          emitStructuredLog(
            buildLogEntry(normalizedOptions, {
              ...input,
              ...(extra || {}),
              level: 'error',
              outcome: 'failed',
              duration_ms: Date.now() - startedAt,
              error,
            })
          ),
      };
    },
  };
};

export const logger = createLogger({ module: 'app' });

export function getLogContext(): LogContext {
  return {
    ...baseContext,
    ...(contextStorage.getStore() || {}),
  };
}

export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const current = getLogContext();
  return contextStorage.run(
    {
      ...current,
      ...context,
      entity: mergeRecords(current.entity, context.entity),
      data: mergeRecords(current.data, context.data),
    },
    fn
  );
}

export function setBaseLogContext(context: LogContext): void {
  baseContext = {
    ...baseContext,
    ...context,
    entity: mergeRecords(baseContext.entity, context.entity),
    data: mergeRecords(baseContext.data, context.data),
  };
}

export function createLogId(prefix?: string): string {
  const value = randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${value}` : value;
}

export function setLoggingEnabled(enabled: boolean): void {
  runtimeConfig.enabled = Boolean(enabled);
}

export function setLogLevel(level: string): void {
  const normalized = normalizeLogLevel(level);
  if (!normalized) return;
  runtimeConfig.level = normalized;
  const winstonLogger = getSinkLogger();
  winstonLogger.level = normalized;
}

export function applyAppLoggingConfig(
  config: Pick<AppConfig, 'security'> | AppConfig | null | undefined
): void {
  if (!config) return;
  const security = 'security' in config ? config.security : undefined;
  if (!security) return;
  setLoggingEnabled(Boolean(security.enableLogging));
  setLogLevel(security.logLevel);
}

export function getRuntimeLoggingConfig(): RuntimeLoggingConfig {
  return { ...runtimeConfig };
}

export function sanitizeLogData<T>(value: T): T {
  return sanitizeUnknown(value) as T;
}

export function createStructuredLogEntry(
  options: ModuleLoggerOptions,
  input: LogEventInput
): StructuredLogEntry {
  return buildLogEntry(options, input);
}

export function writeStructuredLogEntry(entry: StructuredLogEntry): StructuredLogEntry {
  return emitStructuredLog(entry);
}
