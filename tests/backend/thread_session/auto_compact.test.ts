import { describe, expect, it } from 'vitest';

import { autoCompactHistory } from '@iki/backend/agent/context_budget';

const msg = (text: string) => ({ role: 'user' as const, content: text });

describe('autoCompactHistory', () => {
  it('returns history unchanged when no budget is known', () => {
    const history = [msg('hello'), msg('world')];
    const result = autoCompactHistory({ history });
    expect(result).toEqual({ history, omitted: [], compacted: false, droppedCount: 0 });
  });

  it('returns history unchanged while under the compaction threshold', () => {
    const history = [msg('hello'), msg('world')];
    const result = autoCompactHistory({ history, maxInputTokens: 10_000 });
    expect(result.compacted).toBe(false);
    expect(result.history).toBe(history);
  });

  it('plans a complete omitted prefix without inventing a summary', () => {
    const history = [msg('a'.repeat(400)), msg('b'.repeat(400)), msg('c'.repeat(400)), msg('FINAL')];
    const result = autoCompactHistory({ history, maxInputTokens: 120 });

    expect(result.compacted).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
    expect([...result.omitted, ...result.history]).toEqual(history);
    expect(result.history.at(-1)).toEqual(msg('FINAL'));
    expect(result.history).not.toContain(history[0]);
  });

  it('keeps system instructions, current user and complete tool pairs within a long turn', () => {
    const system = { role: 'system' as const, content: 'workspace instructions' };
    const user = msg('keep the public API');
    const call = (id: string) => ({ role: 'assistant' as const, content: [{ type: 'tool-call' as const, toolCallId: id, toolName: 'read_file', input: {} }] });
    const result = (id: string, text: string) => ({ role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: id, toolName: 'read_file', output: { type: 'text' as const, value: text } }] });
    const history = [system, user, call('old'), result('old', 'old data '.repeat(500)), call('new'), result('new', 'latest')];
    const planned = autoCompactHistory({ history, maxInputTokens: 300 });
    expect(planned.history).toEqual([system, user, history[4], history[5]]);
    expect(planned.omitted).toEqual([history[2], history[3]]);
  });

  it('always keeps the most recent message even when it alone exceeds the keep budget', () => {
    const history = [msg('x'.repeat(400)), msg('FINAL')];
    const result = autoCompactHistory({ history, maxInputTokens: 50, keepRatio: 0.1 });

    expect(result.compacted).toBe(true);
    expect(result.history.at(-1)).toEqual(msg('FINAL'));
  });
});
