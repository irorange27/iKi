// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { isContextOverflowError } from '@iki/backend/utils/errors';

describe('isContextOverflowError', () => {
  it('matches the real provider over-length strings', () => {
    const messages = [
      "This model's maximum context length is 163840 tokens",
      'context_length_exceeded: the request exceeds the available context window',
      'input length exceeds context window',
      'prompt is too long: 200000 tokens > 180000 maximum',
      'input length and max_tokens exceed context limit',
      'Request too large: token limit reached',
      'Token limit reached: 120000 tokens > 100000 maximum',
    ];
    for (const message of messages) expect(isContextOverflowError(message)).toBe(true);
  });

  it('rejects unrelated and empty messages, and non-strings', () => {
    expect(isContextOverflowError('rate limit exceeded, try again')).toBe(false);
    expect(isContextOverflowError('ECONNRESET')).toBe(false);
    expect(isContextOverflowError('')).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
    expect(isContextOverflowError(42)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isContextOverflowError('Maximum Context Length exceeded')).toBe(true);
    expect(isContextOverflowError('TOKEN LIMIT')).toBe(true);
  });
});
