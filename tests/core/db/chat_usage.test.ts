import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/db/database', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../../../src/core/db/database';
import {
  addChatUsageEvent,
  getChatUsageTotals,
  listChatUsageDaily,
  listChatUsageMonthly,
} from '../../../src/core/db/chat_usage';

const getDbMock = vi.mocked(getDb);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chat_usage db', () => {
  it('sanitizes usage event payload before insert', () => {
    const runMock = vi.fn();
    const prepareMock = vi.fn(() => ({ run: runMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    addChatUsageEvent({
      id: 'usage_1',
      thread_id: 'thread_1',
      message_id: 'msg_1',
      provider_type: 'openai',
      model: 'gpt-4o-mini',
      input_tokens: -2,
      output_tokens: 3.7,
      total_tokens: 1,
      cache_read_tokens: -1,
      cache_write_tokens: 2.2,
      reasoning_tokens: -9,
      estimated_cost_usd: -0.1,
      source: '  ',
      metadata: '',
      created_at: '2026-03-20T00:00:00.000Z',
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.input_tokens).toBe(0);
    expect(params.output_tokens).toBe(3);
    expect(params.total_tokens).toBe(1);
    expect(params.cache_read_tokens).toBe(0);
    expect(params.cache_write_tokens).toBe(2);
    expect(params.reasoning_tokens).toBe(0);
    expect(params.estimated_cost_usd).toBe(0);
    expect(params.source).toBe('chat');
    expect(params.metadata).toBe('{}');
  });

  it('returns aggregate totals with non-negative coercion', () => {
    const getMock = vi.fn(() => ({
      messageCount: 5,
      inputTokens: 120,
      outputTokens: 34,
      totalTokens: 154,
      cacheReadTokens: 80,
      cacheWriteTokens: 4,
      reasoningTokens: 12,
      estimatedCostUsd: 0.028,
    }));
    const prepareMock = vi.fn(() => ({ get: getMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const totals = getChatUsageTotals({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-20T00:00:00.000Z',
    });

    expect(totals).toEqual({
      messageCount: 5,
      inputTokens: 120,
      outputTokens: 34,
      totalTokens: 154,
      cacheReadTokens: 80,
      cacheWriteTokens: 4,
      reasoningTokens: 12,
      estimatedCostUsd: 0.028,
    });

    expect(getMock).toHaveBeenCalledWith({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-20T00:00:00.000Z',
    });
  });

  it('maps daily and monthly aggregates', () => {
    const allMock = vi
      .fn()
      .mockReturnValueOnce([
        {
          date: '2026-03-19',
          messageCount: 2,
          inputTokens: 50,
          outputTokens: 10,
          totalTokens: 60,
          cacheReadTokens: 40,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0.01,
        },
      ])
      .mockReturnValueOnce([
        {
          month: '2026-03',
          messageCount: 4,
          inputTokens: 140,
          outputTokens: 30,
          totalTokens: 170,
          cacheReadTokens: 90,
          cacheWriteTokens: 3,
          reasoningTokens: 5,
          estimatedCostUsd: 0.031,
        },
      ]);

    const prepareMock = vi.fn(() => ({ all: allMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const daily = listChatUsageDaily();
    const monthly = listChatUsageMonthly();

    expect(daily).toEqual([
      {
        date: '2026-03-19',
        messageCount: 2,
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0.01,
      },
    ]);

    expect(monthly).toEqual([
      {
        month: '2026-03',
        messageCount: 4,
        inputTokens: 140,
        outputTokens: 30,
        totalTokens: 170,
        cacheReadTokens: 90,
        cacheWriteTokens: 3,
        reasoningTokens: 5,
        estimatedCostUsd: 0.031,
      },
    ]);
  });
});
