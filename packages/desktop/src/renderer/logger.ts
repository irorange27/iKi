import type {
  StructuredLogEntry,
  StructuredLogError,
  StructuredLogLevel,
  StructuredLogOutcome,
} from '@iki/core/types/logging';
import { formatStructuredConsoleLine } from '@iki/core/logging/console_formatter';

type LogEventInput = {
  level: StructuredLogLevel;
  event?: string;
  outcome?: StructuredLogOutcome;
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

const SCHEMA_VERSION = 1 as const;
const LEGACY_EVENT = 'legacy.log';
const MAX_STRING_BYTES = 1024;
const MAX_STACK_BYTES = 8192;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_DEPTH = 5;
const MAX_ERROR_CAUSE_DEPTH = 3;
const TRUNCATED_VALUE = '[TRUNCATED]';
const OMITTED_VALUE = '[OMITTED]';
const REDACTED_VALUE = '[REDACTED]';
const REDACTED_KEY_PATTERN = /(token|secret|authorization|cookie|password|credential|api[-_]?key)/i;
const LEVEL_PRIORITY: Record<StructuredLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const getProcessEnv = (): Record<string, string | undefined> | undefined => {
  if (typeof process === 'undefined') return undefined;
  return process.env;
};

const isTestEnvironment = (): boolean => {
  const env = getProcessEnv();
  return env?.VITEST === 'true' || env?.NODE_ENV === 'test';
};

const normalizeLogLevel = (level: unknown): StructuredLogLevel | null => {
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
};

const runtimeConfig = {
  enabled: !isTestEnvironment(),
  level: normalizeLogLevel(getProcessEnv()?.LOG_LEVEL) || 'debug',
};

const measureStringBytes = (value: string): number => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
};

const truncateString = (value: string, maxBytes = MAX_STRING_BYTES): string => {
  if (measureStringBytes(value) <= maxBytes) return value;

  let result = '';
  for (const char of value) {
    const candidate = result + char;
    if (measureStringBytes(candidate) > maxBytes) break;
    result = candidate;
  }

  return `${result}${TRUNCATED_VALUE}`;
};

const shouldRedactKey = (key: string): boolean =>
  key !== 'trace_id' &&
  key !== 'request_id' &&
  key !== 'session_id' &&
  REDACTED_KEY_PATTERN.test(key);

const sanitizeUnknown = (
  value: unknown,
  options?: {
    depth?: number;
    seen?: WeakSet<object>;
    maxStringBytes?: number;
  }
): unknown => {
  const depth = options?.depth ?? 0;
  const seen = options?.seen ?? new WeakSet<object>();
  const maxStringBytes = options?.maxStringBytes ?? MAX_STRING_BYTES;

  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateString(value, maxStringBytes);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return truncateString(value.toString(), maxStringBytes);
  if (typeof value === 'symbol') return truncateString(String(value), maxStringBytes);
  if (typeof value === 'function') return OMITTED_VALUE;
  if (value instanceof Error) return normalizeError(value);

  if (depth >= MAX_OBJECT_DEPTH) {
    return TRUNCATED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item =>
      sanitizeUnknown(item, {
        depth: depth + 1,
        seen,
        maxStringBytes,
      })
    );
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = shouldRedactKey(key)
        ? REDACTED_VALUE
        : sanitizeUnknown(entry, {
            depth: depth + 1,
            seen,
            maxStringBytes,
          });
    }
    return next;
  }

  return truncateString(String(value), maxStringBytes);
};

const toPlainRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const sanitized = sanitizeUnknown(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : undefined;
};

const normalizeError = (error: unknown, depth = 0): StructuredLogError | undefined => {
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
      ...(error.stack ? { stack: truncateString(error.stack, MAX_STACK_BYTES) } : {}),
      ...(cause ? { cause } : {}),
    };
  }

  if (typeof error === 'string') {
    return { message: truncateString(error) };
  }

  if (typeof error === 'object') {
    const sanitized = sanitizeUnknown(error);
    if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
      const record = sanitized as Record<string, unknown>;
      return {
        ...(typeof record.name === 'string' ? { name: truncateString(record.name) } : {}),
        message:
          typeof record.message === 'string'
            ? truncateString(record.message)
            : truncateString(JSON.stringify(record), MAX_STACK_BYTES),
        ...(typeof record.code === 'string' ? { code: truncateString(record.code) } : {}),
        ...(typeof record.stack === 'string'
          ? { stack: truncateString(record.stack, MAX_STACK_BYTES) }
          : {}),
      };
    }
  }

  return { message: truncateString(String(error)) };
};

const deriveMessage = (entry: Pick<StructuredLogEntry, 'event' | 'outcome' | 'message'>): string => {
  if (entry.message && entry.message.trim()) return truncateString(entry.message.trim(), MAX_STACK_BYTES);
  return truncateString([entry.event, entry.outcome].filter(Boolean).join(' '), MAX_STACK_BYTES);
};

const shouldEmitLevel = (level: StructuredLogLevel): boolean =>
  LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[runtimeConfig.level];

const emitStructuredLog = (entry: StructuredLogEntry): StructuredLogEntry => {
  if (!runtimeConfig.enabled || !shouldEmitLevel(entry.level)) {
    return entry;
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('iki:renderer-log', { detail: entry }));
  }

  const sink = Reflect.get(globalThis as object, 'console') as
    | Partial<Record<'debug' | 'info' | 'warn' | 'error' | 'log', (...args: unknown[]) => void>>
    | undefined;
  if (!sink) return entry;

  const method =
    typeof sink[entry.level] === 'function'
      ? entry.level
      : typeof sink.log === 'function'
        ? 'log'
        : null;
  if (!method) return entry;

  sink[method]?.(
    formatStructuredConsoleLine(
      {
        ...entry,
        message: deriveMessage(entry),
      },
      {
        colorize: false,
      }
    ),
    entry
  );

  return entry;
};

const buildLogEntry = (options: ModuleLoggerOptions, input: LogEventInput, legacyDetails?: unknown): StructuredLogEntry => ({
  ts: new Date().toISOString(),
  schema_version: SCHEMA_VERSION,
  level: input.level,
  process: 'renderer',
  module: options.module.trim() || 'renderer',
  event: input.event || LEGACY_EVENT,
  ...(input.outcome ? { outcome: input.outcome } : {}),
  ...(input.trace_id ? { trace_id: input.trace_id } : {}),
  ...(input.request_id ? { request_id: input.request_id } : {}),
  ...(input.session_id ? { session_id: input.session_id } : {}),
  ...(typeof input.duration_ms === 'number' ? { duration_ms: input.duration_ms } : {}),
  ...(input.entity ? { entity: toPlainRecord(input.entity) } : {}),
  ...(input.data || toPlainRecord(legacyDetails)
    ? { data: { ...(toPlainRecord(input.data) || {}), ...(toPlainRecord(legacyDetails) || {}) } }
    : {}),
  ...(input.message ? { message: truncateString(input.message, MAX_STACK_BYTES) } : {}),
  ...(normalizeError(input.error ?? (legacyDetails instanceof Error ? legacyDetails : undefined))
    ? { error: normalizeError(input.error ?? (legacyDetails instanceof Error ? legacyDetails : undefined)) }
    : {}),
  ...(typeof input.retryable === 'boolean' ? { retryable: input.retryable } : {}),
  ...(typeof input.fallback_applied === 'boolean'
    ? { fallback_applied: input.fallback_applied }
    : {}),
});

const createLegacyMethod = (level: StructuredLogLevel, options: ModuleLoggerOptions): LogMethod => {
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
};

export const createLogger = (options: ModuleLoggerOptions): ModuleLogger => {
  const normalizedOptions: ModuleLoggerOptions = {
    module: options.module.trim() || 'renderer',
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

export const logger = createLogger({ module: 'renderer' });
