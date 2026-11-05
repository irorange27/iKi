/** Retry policy for a single tool. Pure data; no backend dependency. */
export interface ToolRetryConfig {
  maxRetries: number;
  backoffMs?: number;
  retryableError?: (error: unknown) => boolean;
  fallback?: (lastError: unknown) => unknown | Promise<unknown>;
}
