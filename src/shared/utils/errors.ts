export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error === null || error === undefined) return 'Unknown error';
  return String(error);
};

/**
 * Error thrown by tool handlers for transient failures that should be retried.
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/**
 * Check whether an error is transient and should be retried.
 *
 * Detects:
 * - RetryableError instances
 * - Common Node.js transient error codes (ECONNRESET, ETIMEDOUT, EBUSY, etc.)
 * - Rate-limiting and temporary-unavailable patterns in error messages
 */
export const isRetryableError = (error: unknown): boolean => {
  if (error instanceof RetryableError) return true;

  if (error instanceof Error) {
    // Common Node.js transient system errors
    const err = error as NodeJS.ErrnoException;
    if (
      err.code === 'ECONNRESET' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ENOTFOUND' ||
      err.code === 'EAI_AGAIN' ||
      err.code === 'EBUSY' ||
      err.code === 'EPIPE' ||
      err.code === 'ECANCELED'
    ) {
      return true;
    }

    // Abort/timeout signals
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;

    // Rate limiting and temporary-unavailable indicators
    const msg = err.message.toLowerCase();
    if (
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('temporarily') ||
      msg.includes('try again')
    ) {
      return true;
    }
  }

  return false;
};
