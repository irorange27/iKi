import { describe, expect, it } from 'vitest';

import { getErrorMessage, getStreamErrorMessage } from '@iki/backend/utils/errors';

describe('error utils', () => {
  it('prefers Error messages', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('normalizes nullish values to a stable fallback', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
  });

  it('stringifies other values', () => {
    expect(getErrorMessage(42)).toBe('42');
  });

  it('unwraps API call errors from stream wrapper errors', () => {
    const apiError = Object.assign(new Error('Invalid max_tokens value, the valid range is [1, 393216]'), {
      name: 'AI_APICallError',
      statusCode: 400,
    });
    const wrapper = Object.assign(new Error('No output generated. Check the stream for errors.', {
      cause: apiError,
    }) as Error, { name: 'AI_NoOutputGeneratedError' });

    expect(getStreamErrorMessage(wrapper)).toBe(
      'Invalid max_tokens value, the valid range is [1, 393216]'
    );
  });

  it('falls back to the top-level message without an API call error', () => {
    expect(getStreamErrorMessage(new Error('boom'))).toBe('boom');
    expect(getStreamErrorMessage(null)).toBe('Unknown error');
  });

  it('returns the wrapper message when the cause chain has no API error', () => {
    const wrapper = new Error('No output generated.', { cause: new Error('socket hang up') });
    expect(getStreamErrorMessage(wrapper)).toBe('No output generated.');
  });
});
