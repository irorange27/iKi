import { describe, expect, it } from 'vitest';
import { getCachedInputTokens, getUncachedInputTokens } from '../src/utils/token_usage';

describe('@iki/core token usage helpers', () => {
  it('treats only cacheReadTokens as cache hits and keeps cacheWriteTokens in uncached input', () => {
    const turn1 = {
      inputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 9_800,
    };
    expect(getCachedInputTokens(turn1)).toBe(0);
    expect(getUncachedInputTokens(turn1)).toBe(10_000);

    const turn2 = {
      inputTokens: 12_000,
      cacheReadTokens: 9_000,
      cacheWriteTokens: 2_000,
    };
    expect(getCachedInputTokens(turn2)).toBe(9_000);
    expect(getUncachedInputTokens(turn2)).toBe(3_000);
  });

  it('clamps missing, negative, or oversized cacheRead values safely', () => {
    expect(getCachedInputTokens({})).toBe(0);
    expect(getUncachedInputTokens({})).toBe(0);
    expect(getUncachedInputTokens({ inputTokens: 100, cacheReadTokens: 120 })).toBe(0);
    expect(getCachedInputTokens({ cacheReadTokens: -50 })).toBe(0);
  });
});
