export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error === null || error === undefined) return 'Unknown error';
  return String(error);
};

const MAX_ERROR_CAUSE_DEPTH = 5;

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

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export const isContextOverflowError = (message: unknown): boolean => {
  const msg = typeof message === 'string' ? message.toLowerCase() : '';
  if (!msg) return false;
  return (
    msg.includes('context length') ||
    msg.includes('context_length') ||
    msg.includes('context window') ||
    msg.includes('maximum context') ||
    msg.includes('too many tokens') ||
    msg.includes('token limit') ||
    msg.includes('input length') ||
    msg.includes('input is too long') ||
    msg.includes('prompt is too long') ||
    msg.includes('request too large')
  );
};

export const isRetryableError = (error: unknown): boolean => {
  if (error instanceof RetryableError) return true;
  if (error instanceof RefusalError) return true;

  const candidate =
    error instanceof Error
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message: unknown })
        : null;

  if (!candidate) return false;

  const err = candidate as NodeJS.ErrnoException & { message: unknown };

  if (err.name === 'AbortError') return false;

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
