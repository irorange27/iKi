export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error === null || error === undefined) return 'Unknown error';
  return String(error);
};

const MAX_ERROR_CAUSE_DEPTH = 5;

/**
 * Message for stream failures. AI SDK wrappers like NoOutputGeneratedError
 * hide the provider's own detail ("Invalid max_tokens value...", rate limits)
 * behind a generic top-level message; walk the cause chain and prefer the
 * first API-call error, which carries the provider response.
 */
export const getStreamErrorMessage = (error: unknown): string => {
  const fallback = getErrorMessage(error);
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) break;
    const candidate = current as Error & { statusCode?: unknown };
    if (candidate.name === 'AI_APICallError' || typeof candidate.statusCode === 'number') {
      return candidate.message || fallback;
    }
    current = candidate.cause;
  }

  return fallback;
};

const REFUSAL_PATTERNS = [
  /\bI (?:am unable to|cannot|can't|won't|am not able to) (?:assist|comply|generate|create|write|provide|help|fulfil|engage|participate|do that)\b/i,
  /\b(?:content policy|safety guidelines?|acceptable use|against my (?:guidelines|policies|terms)|terms of service)\b/i,
  /\bviolates? (?:my|the|our|content|safety) (?:policy|guidelines)\b/i,
];

export const looksLikeRefusal = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 500) return false;
  return REFUSAL_PATTERNS.some(pattern => pattern.test(trimmed));
};

/**
 * Error thrown when the model refuses to respond (content filter, safety, etc.).
 */
export class RefusalError extends Error {
  constructor(
    message: string,
    public readonly finishReason?: string,
    public readonly refusalText?: string
  ) {
    super(message);
    this.name = 'RefusalError';
  }
}

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
  if (error instanceof RefusalError) return true;

  // Extract message from Error instances or plain objects with .message
  const candidate =
    error instanceof Error
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message: unknown })
        : null;

  if (!candidate) return false;

  const err = candidate as NodeJS.ErrnoException & { message: unknown };

  // Intentional cancellation — not retryable
  if (err.name === 'AbortError') return false;

  // Common Node.js transient system errors
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

  if (err.name === 'TimeoutError') return true;

  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';

  // Rate limiting, server errors, and temporary-unavailable indicators
  return (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('internal server error') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily') ||
    msg.includes('try again')
  );
};
