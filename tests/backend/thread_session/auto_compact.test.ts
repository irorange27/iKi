import { describe, expect, it } from 'vitest';

import { autoCompactHistory } from '@iki/backend/thread_session/token_estimator';

const msg = (text: string) => ({ role: 'user' as const, content: text });

describe('autoCompactHistory', () => {
  it('returns history unchanged when no budget is known', () => {
    const history = [msg('hello'), msg('world')];
    const result = autoCompactHistory({ history });
    expect(result).toEqual({ history, compacted: false, droppedCount: 0 });
  });

  it('returns history unchanged while under the compaction threshold', () => {
    const history = [msg('hello'), msg('world')];
    const result = autoCompactHistory({ history, maxInputTokens: 10_000 });
    expect(result.compacted).toBe(false);
    expect(result.history).toBe(history);
  });

  it('compacts to the recent window and prepends a marker when over the threshold', () => {
    const history = [msg('a'.repeat(400)), msg('b'.repeat(400)), msg('c'.repeat(400)), msg('FINAL')];
    const result = autoCompactHistory({ history, maxInputTokens: 120 });

    expect(result.compacted).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
    expect(result.history[0]?.role).toBe('system');
    expect(String(result.history[0]?.content)).toContain('[AUTO COMPACT]');
    expect(result.history.at(-1)).toEqual(msg('FINAL'));
    expect(result.history).not.toContain(history[0]);
  });

  it('always keeps the most recent message even when it alone exceeds the keep budget', () => {
    const history = [msg('x'.repeat(400)), msg('FINAL')];
    const result = autoCompactHistory({ history, maxInputTokens: 50, keepRatio: 0.1 });

    expect(result.compacted).toBe(true);
    expect(result.history.at(-1)).toEqual(msg('FINAL'));
  });
});
