import { describe, expect, it } from 'vitest';
import {
  accumulateUsageTotals,
  extractTurnTokenUsage,
  formatTurnUsageBadge,
  type UsageTotals,
} from '../src/commands';

describe('CLI token usage accumulation and formatting', () => {
  it('counts only cacheReadTokens as cache hits and keeps cacheWriteTokens in uncached input', () => {
    const totals: UsageTotals = {
      turns: 0,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };

    const turn1 = extractTurnTokenUsage({
      inputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 9_800,
      outputTokens: 300,
    });
    accumulateUsageTotals(totals, turn1);

    expect(totals).toEqual({
      turns: 0,
      uncachedInputTokens: 10_000,
      cacheReadTokens: 0,
      outputTokens: 300,
    });
    expect(formatTurnUsageBadge(turn1, '1.0')).toBe('[in 10000 · cache 0 · out 300 · 1.0s]');

    const turn2 = extractTurnTokenUsage({
      inputTokens: 12_000,
      cacheReadTokens: 9_000,
      cacheWriteTokens: 2_000,
      outputTokens: 500,
    });
    accumulateUsageTotals(totals, turn2);

    expect(totals).toEqual({
      turns: 0,
      uncachedInputTokens: 13_000,
      cacheReadTokens: 9_000,
      outputTokens: 800,
    });
    expect(formatTurnUsageBadge(turn2, '1.2')).toBe('[in 3000 · cache 9000 · out 500 · 1.2s]');
  });

  it('handles missing or malformed fields and never produces negative counts', () => {
    const totals: UsageTotals = {
      turns: 0,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };

    const clamped = extractTurnTokenUsage({
      inputTokens: 100,
      cacheReadTokens: 120,
      cacheWriteTokens: 700,
    });
    accumulateUsageTotals(totals, clamped);
    expect(totals).toEqual({
      turns: 0,
      uncachedInputTokens: 0,
      cacheReadTokens: 120,
      outputTokens: 0,
    });
    expect(formatTurnUsageBadge({}, '0.1')).toBe('[in 0 · cache 0 · out 0 · 0.1s]');
    expect(formatTurnUsageBadge({ inputTokens: 500 }, '0.5')).toBe(
      '[in 500 · cache 0 · out 0 · 0.5s]'
    );
  });
});
