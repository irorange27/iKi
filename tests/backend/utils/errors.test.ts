// @vitest-environment node

/** isContextOverflowError (#124): conservative lowercase classification of
 * provider context-over-length rejections — the one failure class a request
 * rebuild (compaction) can fix. A miss is terminal by design; a false
 * positive costs one wasted compaction. */
import { describe, expect, it } from 'vitest';

import { isContextOverflowError } from '@iki/backend/utils/errors';

describe('isContextOverflowError', () => {
  it('matches the real provider over-length strings', () => {
    const messages = [
      // OpenAI / vLLM / DeepSeek
      "This model's maximum context length is 163840 tokens",
      'context_length_exceeded: the request exceeds the available context window',
      // Ollama
      'input length exceeds context window',
      // Anthropic
      'prompt is too long: 200000 tokens > 180000 maximum',
      'input length and max_tokens exceed context limit',
      // Groq / Together
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
