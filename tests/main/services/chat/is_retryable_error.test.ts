import { describe, expect, it } from 'vitest';

import { isRetryableError } from '@iki/core/utils/errors';

describe('isRetryableError', () => {
  // Rate limit errors
  it('matches "rate limit" in message', () => {
    expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
  });

  it('matches "too many requests" in message', () => {
    expect(isRetryableError(new Error('Too many requests'))).toBe(true);
  });

  it('matches HTTP 429 status', () => {
    expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
  });

  // Server errors
  it('matches HTTP 503', () => {
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('matches HTTP 502', () => {
    expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
  });

  it('matches HTTP 504', () => {
    expect(isRetryableError(new Error('504 Gateway Timeout'))).toBe(true);
  });

  it('matches "internal server error" in message', () => {
    expect(isRetryableError(new Error('Internal Server Error'))).toBe(true);
  });

  it('matches "overloaded" in message', () => {
    expect(isRetryableError(new Error('Server is overloaded'))).toBe(true);
  });

  // Timeout errors
  it('matches "timeout" in message', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true);
  });

  // Network errors
  it('matches "econnrefused" in message', () => {
    expect(isRetryableError(new Error('connect ECONNREFUSED'))).toBe(true);
  });

  it('matches "econnreset" in message', () => {
    expect(isRetryableError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('matches "etimedout" in message', () => {
    expect(isRetryableError(new Error('connect ETIMEDOUT'))).toBe(true);
  });

  it('matches "network" in message', () => {
    expect(isRetryableError(new Error('Network error occurred'))).toBe(true);
  });

  it('matches "fetch failed" in message', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
  });

  // Case insensitivity
  it('handles uppercase variants', () => {
    expect(isRetryableError(new Error('RATE LIMIT'))).toBe(true);
    expect(isRetryableError(new Error('TOO MANY REQUESTS'))).toBe(true);
    expect(isRetryableError(new Error('INTERNAL SERVER ERROR'))).toBe(true);
  });

  it('handles mixed case variants', () => {
    expect(isRetryableError(new Error('Rate Limit Exceeded'))).toBe(true);
    expect(isRetryableError(new Error('Fetch Failed'))).toBe(true);
    expect(isRetryableError(new Error('Network Error'))).toBe(true);
  });

  // Realistic provider error shapes
  it('recognizes OpenAI rate limit error (Error object)', () => {
    const error = new Error('429 You exceeded your current quota, please check your plan and billing details.');
    expect(isRetryableError(error)).toBe(true);
  });

  it('recognizes Anthropic overloaded error', () => {
    const error = new Error('529 Overloaded - Anthropic is experiencing high demand');
    expect(isRetryableError(error)).toBe(true);
  });

  it('recognizes DeepSeek server error', () => {
    const error = new Error('503 Service Temporarily Unavailable');
    expect(isRetryableError(error)).toBe(true);
  });

  it('recognizes error objects with message property (not Error instances)', () => {
    expect(isRetryableError({ message: 'rate limit hit' })).toBe(true);
  });

  it('recognizes error objects with .message property', () => {
    expect(isRetryableError({ message: 'fetch failed' })).toBe(true);
  });

  // Non-retryable errors
  it('rejects AbortError', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    expect(isRetryableError(error)).toBe(false);
  });

  it('rejects authentication errors', () => {
    expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false);
    expect(isRetryableError(new Error('Invalid API key'))).toBe(false);
  });

  it('rejects bad request errors', () => {
    expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
  });

  it('rejects not found errors', () => {
    expect(isRetryableError(new Error('404 Not Found'))).toBe(false);
  });

  it('rejects validation errors', () => {
    expect(isRetryableError(new Error('Invalid model parameter'))).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('rejects non-error objects without message', () => {
    expect(isRetryableError({})).toBe(false);
    expect(isRetryableError({ code: 429 })).toBe(false);
  });

  it('rejects plain strings', () => {
    expect(isRetryableError('rate limit')).toBe(false);
  });

  // Edge cases: numbers embedded in message
  it('matches retryable codes appearing anywhere in the message', () => {
    expect(isRetryableError(new Error('Got status 429 from upstream'))).toBe(true);
    expect(isRetryableError(new Error('Upstream returned 503'))).toBe(true);
    expect(isRetryableError(new Error('Error code 502 received'))).toBe(true);
  });
});
