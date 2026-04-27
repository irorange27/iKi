import { createLogger } from '../logger';
import { isRetryableError } from '../../shared/utils/errors';

const retryLogger = createLogger({ module: 'tool_retry' });

export interface ToolRetryConfig {
  /** Maximum number of retry attempts (total attempts = 1 + maxRetries). */
  maxRetries: number;
  /** Base backoff in milliseconds. Doubles each attempt, capped at 2000ms. Default 250. */
  backoffMs?: number;
  /** Custom predicate to decide if an error should be retried. Falls back to isRetryableError. */
  retryableError?: (error: unknown) => boolean;
  /**
   * If provided, called when all retries are exhausted.
   * The return value replaces the error, allowing graceful degradation
   * (e.g., returning partial output on timeout).
   */
  fallback?: (lastError: unknown) => unknown | Promise<unknown>;
}

const MAX_BACKOFF_MS = 2000;

/**
 * Wrap a handler function with exponential-backoff retry logic.
 *
 * Returns the handler unchanged if maxRetries is 0.
 * Retries only on errors that pass the retryable predicate (defaulting to
 * `isRetryableError` from the shared error utilities).
 */
export function withRetry<P extends unknown[], R>(
  handler: (...args: P) => Promise<R>,
  config: ToolRetryConfig
): (...args: P) => Promise<R> {
  const maxRetries = Math.max(0, Math.trunc(config.maxRetries));
  const baseBackoff = Math.max(1, Math.trunc(config.backoffMs ?? 250));

  if (maxRetries === 0) return handler;

  return async (...args: P): Promise<R> => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await handler(...args);
      } catch (error) {
        lastError = error;

        const shouldRetry = config.retryableError
          ? config.retryableError(error)
          : isRetryableError(error);

        if (attempt >= maxRetries || !shouldRetry) {
          if (config.fallback) {
            retryLogger.event({
              level: 'warn',
              event: 'tool.retry',
              outcome: 'degraded',
              data: {
                attempts: attempt + 1,
                maxRetries,
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            });
            return (await config.fallback(error)) as R;
          }
          throw error;
        }

        const delayMs = Math.min(MAX_BACKOFF_MS, baseBackoff * Math.pow(2, attempt));

        retryLogger.event({
          level: 'warn',
          event: 'tool.retry',
          outcome: 'attempt',
          data: {
            attempt: attempt + 1,
            maxRetries,
            delayMs,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });

        await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  };
}
