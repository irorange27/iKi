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
  levelLabel: string;
  scopeLabel: string;
  bodyLabel: string;
  extrasLabel: string;
};

const ANSI_RESET = '\u001B[0m';
const ANSI_TIMESTAMP = '\u001B[36m';
const ANSI_DIM = '\u001B[2m';
const ANSI_BOLD = '\u001B[1m';
const ANSI_GREEN = '\u001B[32m';
const ANSI_LEVEL: Record<StructuredLogLevel, string> = {
  debug: '\u001B[90m',
  info: '\u001B[34m',
  warn: '\u001B[33m',
  error: '\u001B[31m',
};

const ANSI_OUTCOME: Record<string, string> = {
  succeeded: '\u001B[32m',
  started: '\u001B[33m',
  failed: '\u001B[31m',
};

const LEVEL_LABEL: Record<StructuredLogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
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

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${(ms / 60_000).toFixed(1)}m`;
};

const buildBodyLabel = (
  entry: StructuredConsoleFormatterInput,
  colorize: boolean
): string => {
  const event = typeof entry.event === 'string' && entry.event.trim() ? entry.event.trim() : '';
  const outcome =
    typeof entry.outcome === 'string' && entry.outcome.trim() ? entry.outcome.trim() : '';
  const message =
    typeof entry.message === 'string' && entry.message.trim() ? entry.message.trim() : '';
  const fallbackMessage = [event, outcome].filter(Boolean).join(' ');

  const eventLabel = colorize ? `${ANSI_BOLD}${event}${ANSI_RESET}` : event;
  const outcomeColor = ANSI_OUTCOME[outcome];
  const outcomeLabel =
    colorize && outcomeColor ? `${outcomeColor}${outcome}${ANSI_RESET}` : outcome;
  const messageLabel =
    message && message !== fallbackMessage ? message : '';

  return [eventLabel, outcomeLabel, messageLabel].filter(Boolean).join('  ');
};

const buildExtrasLabel = (entry: StructuredConsoleFormatterInput): string => {
  const parts: string[] = [];

  if (typeof entry.duration_ms === 'number') {
    parts.push(formatDuration(entry.duration_ms));
  }

  if (typeof entry.trace_id === 'string') {
    parts.push(`tid=${entry.trace_id.slice(0, 8)}`);
  }

  if (typeof entry.request_id === 'string') {
    parts.push(`rid=${entry.request_id.slice(0, 8)}`);
  }

  if (typeof entry.session_id === 'string') {
    parts.push(`sid=${entry.session_id.slice(0, 8)}`);
  }

  // Flatten top-level scalar values from the data bag
  if (entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)) {
    for (const [key, value] of Object.entries(entry.data)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        parts.push(`${key}=${String(value)}`);
      }
    }
  }

  if (entry.error) {
    const err = entry.error as { name?: string; message?: string };
    const name = err.name || 'Error';
    const msg = err.message || '';
    parts.push(`error=${name}${msg ? `: ${msg}` : ''}`);
  }

  return parts.join('  ');
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

  return {
    timestampLabel: colorizeSegment(
      `[${formatConsoleTime(entry.ts, options?.timeZone)}]`,
      ANSI_TIMESTAMP,
      colorize
    ),
    levelLabel: colorizeSegment(`[${LEVEL_LABEL[level]}]`, ANSI_LEVEL[level], colorize),
    scopeLabel: colorizeSegment(`[${processLabel}/${moduleLabel}]`, ANSI_GREEN, colorize),
    bodyLabel: buildBodyLabel(entry, colorize),
    extrasLabel: colorizeSegment(buildExtrasLabel(entry), ANSI_DIM, colorize),
  };
};

export const formatStructuredConsoleLine = (
  entry: StructuredConsoleFormatterInput,
  options?: ConsoleFormatterOptions
): string => {
  const segments = createStructuredConsoleSegments(entry, options);
  return [
    segments.timestampLabel,
    segments.levelLabel,
    segments.scopeLabel,
    segments.bodyLabel,
    segments.extrasLabel,
  ]
    .filter(Boolean)
    .join(' ');
};
