import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../../../src/core/tools/retry';
import { RetryableError, isRetryableError } from '../../../src/shared/utils/errors';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result immediately on success', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const wrapped = withRetry(handler, { maxRetries: 2 });

    const result = await wrapped();
    expect(result).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not retry when maxRetries is 0', async () => {
    let calls = 0;
    const handler = vi.fn().mockImplementation(async () => {
      calls++;
      throw new RetryableError('fail');
    });
    const wrapped = withRetry(handler, { maxRetries: 0 });

    await expect(wrapped()).rejects.toThrow('fail');
    expect(calls).toBe(1);
  });

  it('retries on RetryableError', async () => {
    let calls = 0;
    const handler = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new RetryableError('transient');
      return 'recovered';
    });
    const wrapped = withRetry(handler, { maxRetries: 2 });

    const advanceRetries = async (): Promise<unknown> => {
      const p = wrapped();
      // Advance timers through each retry delay
      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(250 * Math.pow(2, i));
      }
      return p;
    };

    const result = await advanceRetries();
    expect(result).toBe('recovered');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('throws the last error after exhausting retries', async () => {
    vi.useRealTimers();
    let calls = 0;
    const handler = vi.fn().mockImplementation(async () => {
      calls++;
      throw new RetryableError('always fails');
    });
    const wrapped = withRetry(handler, { maxRetries: 2, backoffMs: 1 });

    await expect(wrapped()).rejects.toThrow('always fails');
    expect(calls).toBe(3); // initial + 2 retries
    vi.useFakeTimers();
  });

  it('does not retry on plain Error', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('not retryable'));
    const wrapped = withRetry(handler, { maxRetries: 2 });

    await expect(wrapped()).rejects.toThrow('not retryable');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('uses custom retryableError predicate when provided', async () => {
    let calls = 0;
    const handler = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('custom retryable');
      return 'ok';
    });
    const wrapped = withRetry(handler, {
      maxRetries: 1,
      retryableError: (e) => e instanceof Error && e.message.includes('custom retryable'),
    });

    const p = wrapped();
    await vi.advanceTimersByTimeAsync(250);
    const result = await p;
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('caps backoff at 2000ms', async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('fail 1'))
      .mockRejectedValueOnce(new RetryableError('fail 2'))
      .mockRejectedValueOnce(new RetryableError('fail 3'))
      .mockRejectedValueOnce(new RetryableError('fail 4'))
      .mockResolvedValue('ok');
    const wrapped = withRetry(handler, { maxRetries: 5, backoffMs: 1000 });

    const p = wrapped();
    // backoffMs=1000: delays should be 1000, 2000, 2000, 2000, 2000
    await vi.advanceTimersByTimeAsync(1000); // attempt 1 delay (1000, capped OK)
    await vi.advanceTimersByTimeAsync(2000); // attempt 2 delay (2000, at cap)
    await vi.advanceTimersByTimeAsync(2000); // attempt 3 delay
    await vi.advanceTimersByTimeAsync(2000); // attempt 4 delay
    await p;

    expect(handler).toHaveBeenCalledTimes(5);
  });

  it('passes arguments through to handler', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const wrapped = withRetry(handler, { maxRetries: 1 });

    await wrapped('a', 123, { key: 'val' });
    expect(handler).toHaveBeenCalledWith('a', 123, { key: 'val' });
  });

  it('returns unwrapped handler when maxRetries is 0', () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const wrapped = withRetry(handler, { maxRetries: 0 });

    expect(wrapped).toBe(handler);
  });

  it('calls fallback when all retries are exhausted', async () => {
    vi.useRealTimers();
    const handler = vi.fn().mockRejectedValue(new RetryableError('transient'));
    const fallback = vi.fn().mockReturnValue({ degraded: true, partial: 'data' });
    const wrapped = withRetry(handler, {
      maxRetries: 1,
      backoffMs: 1,
      fallback,
    });

    const result = await wrapped();
    expect(result).toEqual({ degraded: true, partial: 'data' });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
  });

  it('does not call fallback when handler recovers', async () => {
    vi.useRealTimers();
    let calls = 0;
    const handler = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new RetryableError('transient');
      return 'recovered';
    });
    const fallback = vi.fn();
    const wrapped = withRetry(handler, {
      maxRetries: 2,
      backoffMs: 1,
      fallback,
    });

    const result = await wrapped();
    expect(result).toBe('recovered');
    expect(fallback).not.toHaveBeenCalled();
    vi.useFakeTimers();
  });
});

describe('isRetryableError', () => {
  it('detects RetryableError', () => {
    expect(isRetryableError(new RetryableError('test'))).toBe(true);
  });

  it('detects ECONNRESET as retryable', () => {
    const err = new Error('connection reset');
    (err as NodeJS.ErrnoException).code = 'ECONNRESET';
    expect(isRetryableError(err)).toBe(true);
  });

  it('detects ETIMEDOUT as retryable', () => {
    const err = new Error('timed out');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    expect(isRetryableError(err)).toBe(true);
  });

  it('detects EBUSY as retryable', () => {
    const err = new Error('resource busy');
    (err as NodeJS.ErrnoException).code = 'EBUSY';
    expect(isRetryableError(err)).toBe(true);
  });

  it('detects ECONNREFUSED as retryable', () => {
    const err = new Error('connection refused');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    expect(isRetryableError(err)).toBe(true);
  });

  it('detects AbortError as retryable', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isRetryableError(err)).toBe(true);
  });

  it('detects rate limit message as retryable', () => {
    expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('Too many requests'))).toBe(true);
    expect(isRetryableError(new Error('server returned 429'))).toBe(true);
    expect(isRetryableError(new Error('Service temporarily unavailable'))).toBe(true);
  });

  it('returns false for standard Error', () => {
    expect(isRetryableError(new Error('file not found'))).toBe(false);
    expect(isRetryableError(new Error('validation failed'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });
});
