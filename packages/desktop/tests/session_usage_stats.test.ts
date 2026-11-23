import { describe, expect, it } from 'vitest';
import { buildSessionPerfStats } from '../src/renderer/modules/chat/ui_message_references';

describe('Desktop buildSessionPerfStats usage alignment', () => {
  it('reports uncached input (including cache writes) and cache hits (cacheRead only) across turns', () => {
    const stats = buildSessionPerfStats([
      {
        role: 'assistant',
        parts: [
          {
            type: 'data-token-usage',
            data: {
              inputTokens: 10_000,
              cacheReadTokens: 0,
              cacheWriteTokens: 9_500,
              outputTokens: 300,
              steps: 1,
            },
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'data-token-usage',
            data: {
              inputTokens: 12_000,
              cacheReadTokens: 10_000,
              cacheWriteTokens: 1_500,
              outputTokens: 500,
              steps: 2,
            },
          },
        ],
      },
    ]);

    expect(stats).not.toBeNull();
    expect(stats?.inputTokens).toBe(22_000);
    expect(stats?.cacheReadTokens).toBe(10_000);
    expect(stats?.cacheWriteTokens).toBe(11_000);
    expect(stats?.uncachedInputTokens).toBe(12_000);
    expect(stats?.outputTokens).toBe(800);
    expect(stats?.cacheHitPercent).toBeCloseTo((10_000 / 22_000) * 100);
  });
});
