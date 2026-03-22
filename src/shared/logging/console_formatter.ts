import type { StructuredLogEntry, StructuredLogLevel } from '../types/logging';

export type StructuredConsoleFormatterInput = Pick<
  StructuredLogEntry,
  | 'ts'
  | 'level'
  | 'process'
  | 'module'
  | 'event'
  | 'outcome'
  | 'message'
  | 'trace_id'
  | 'request_id'
  | 'session_id'
  | 'duration_ms'
  | 'entity'
  | 'data'
  | 'error'
>;

type ConsoleFormatterOptions = {
  colorize?: boolean;
  timeZone?: string;
};

type ConsoleLogSegments = {
  timestampLabel: string;
  processLabel: string;
  levelLabel: string;
  scopeLabel: string;
  bodyLabel: string;
  extrasLabel: string;
};

const ANSI_RESET = '\u001B[0m';
const ANSI_TIMESTAMP = '\u001B[36m';
const ANSI_LEVEL: Record<StructuredLogLevel, string> = {
  debug: '\u001B[90m',
  info: '\u001B[34m',
  warn: '\u001B[33m',
  error: '\u001B[31m',
};

const isStructuredLogLevel = (value: unknown): value is StructuredLogLevel =>
  value === 'debug' || value === 'info' || value === 'warn' || value === 'error';

const padNumber = (value: number, width = 2): string => String(value).padStart(width, '0');

const resolveDate = (ts: string | undefined): Date => {
  if (typeof ts === 'string') {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

const formatConsoleTime = (ts: string | undefined, timeZone?: string): string => {
  const date = resolveDate(ts);
  if (timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
        timeZone,
      });
      return formatter.format(date);
    } catch {
      // fall back to the local console clock when the requested zone is invalid
    }
  }

  return [
    padNumber(date.getHours()),
    padNumber(date.getMinutes()),
    padNumber(date.getSeconds()),
  ].join(':') + `.${padNumber(date.getMilliseconds(), 3)}`;
};

const colorizeSegment = (value: string, color: string, enabled: boolean): string =>
  enabled ? `${color}${value}${ANSI_RESET}` : value;

const buildBodyLabel = (entry: StructuredConsoleFormatterInput): string => {
  const event = typeof entry.event === 'string' && entry.event.trim() ? entry.event.trim() : '';
  const outcome =
    typeof entry.outcome === 'string' && entry.outcome.trim() ? entry.outcome.trim() : '';
  const message =
    typeof entry.message === 'string' && entry.message.trim() ? entry.message.trim() : '';
  const fallbackMessage = [event, outcome].filter(Boolean).join(' ');

  return [event, outcome, message && message !== fallbackMessage ? message : '']
    .filter(Boolean)
    .join(' ');
};

const buildExtrasLabel = (entry: StructuredConsoleFormatterInput): string => {
  const extras = {
    ...(typeof entry.trace_id === 'string' ? { trace_id: entry.trace_id } : {}),
    ...(typeof entry.request_id === 'string' ? { request_id: entry.request_id } : {}),
    ...(typeof entry.session_id === 'string' ? { session_id: entry.session_id } : {}),
    ...(typeof entry.duration_ms === 'number' ? { duration_ms: entry.duration_ms } : {}),
    ...(entry.entity ? { entity: entry.entity } : {}),
    ...(entry.data ? { data: entry.data } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };

  return Object.keys(extras).length > 0 ? JSON.stringify(extras) : '';
};

export const createStructuredConsoleSegments = (
  entry: StructuredConsoleFormatterInput,
  options?: ConsoleFormatterOptions
): ConsoleLogSegments => {
  const colorize = options?.colorize === true;
  const processLabel =
    typeof entry.process === 'string' && entry.process.trim() ? entry.process.trim() : 'main';
  const moduleLabel =
    typeof entry.module === 'string' && entry.module.trim() ? entry.module.trim() : 'app';
  const level = isStructuredLogLevel(entry.level) ? entry.level : 'info';
  const timestampLabel = `[${formatConsoleTime(entry.ts, options?.timeZone)}]`;
  const scopeLabel = `[${processLabel}/${moduleLabel}]`;

  return {
    timestampLabel: colorizeSegment(timestampLabel, ANSI_TIMESTAMP, colorize),
    processLabel: `[${processLabel}]`,
    levelLabel: colorizeSegment(`[${level}]`, ANSI_LEVEL[level], colorize),
    scopeLabel,
    bodyLabel: buildBodyLabel(entry),
    extrasLabel: buildExtrasLabel(entry),
  };
};

export const formatStructuredConsoleLine = (
  entry: StructuredConsoleFormatterInput,
  options?: ConsoleFormatterOptions
): string => {
  const segments = createStructuredConsoleSegments(entry, options);
  return [
    segments.timestampLabel,
    segments.processLabel,
    segments.levelLabel,
    segments.scopeLabel,
    segments.bodyLabel,
    segments.extrasLabel,
  ]
    .filter(Boolean)
    .join(' ');
};
