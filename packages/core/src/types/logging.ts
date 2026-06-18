export type StructuredLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type StructuredLogProcess = 'renderer' | 'preload' | 'main' | 'daemon';

export type StructuredLogOutcome =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'degraded'
  | 'denied'
  | 'hit'
  | 'miss'
  | 'dedup'
  | 'attempt';

export interface StructuredLogError {
  name?: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: StructuredLogError | string;
}

export interface StructuredLogEntry {
  ts: string;
  schema_version: 1;
  level: StructuredLogLevel;
  process: StructuredLogProcess;
  module: string;
  event: string;
  outcome?: StructuredLogOutcome;
  trace_id?: string;
  request_id?: string;
  session_id?: string;
  duration_ms?: number;
  entity?: Record<string, unknown>;
  data?: Record<string, unknown>;
  message?: string;
  error?: StructuredLogError;
  retryable?: boolean;
  fallback_applied?: boolean;
}
