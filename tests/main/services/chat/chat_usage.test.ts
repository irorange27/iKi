import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/core/db/chat_usage', () => ({
  addChatUsageEvent: vi.fn(),
  getChatUsageTotals: vi.fn(),
  listChatUsageDaily: vi.fn(),
  listChatUsageMonthly: vi.fn(),
}));

import * as chatUsageDb from '@iki/core/db/chat_usage';
import { createChatUsage } from '@iki/core/chat_service/usage';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('chat usage service', () => {
  it('records usage events with normalized token counts', () => {
    const addChatUsageEventMock = vi.mocked(chatUsageDb.addChatUsageEvent);
    const usage = createChatUsage();

    usage.recordUsageEvent({
      threadId: 'thread_1',
      messageId: 'msg_1',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      usage: {
        inputTokens: 100.8,
        outputTokens: 20.4,
        totalTokens: 10,
        cacheReadTokens: -1,
        cacheWriteTokens: 3.2,
        reasoningTokens: 2.9,
        estimatedCostUsd: -0.01,
      },
      source: 'chat.stream',
      metadata: { test: true },
    });

    expect(addChatUsageEventMock).toHaveBeenCalledTimes(1);
    const payload = addChatUsageEventMock.mock.calls[0][0];
    expect(payload.thread_id).toBe('thread_1');
    expect(payload.message_id).toBe('msg_1');
    expect(payload.input_tokens).toBe(100);
    expect(payload.output_tokens).toBe(20);
    expect(payload.total_tokens).toBe(120);
    expect(payload.cache_read_tokens).toBe(0);
    expect(payload.cache_write_tokens).toBe(3);
    expect(payload.reasoning_tokens).toBe(2);
    expect(payload.estimated_cost_usd).toBe(0);
    expect(payload.source).toBe('chat.stream');
  });

  it('builds summary windows and dense heatmap cells', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00.000Z'));

    vi.mocked(chatUsageDb.getChatUsageTotals).mockReturnValue({
      messageCount: 3,
      inputTokens: 300,
      outputTokens: 60,
      totalTokens: 360,
      cacheReadTokens: 120,
      cacheWriteTokens: 0,
      reasoningTokens: 10,
      estimatedCostUsd: 0.08,
    });

    vi.mocked(chatUsageDb.listChatUsageDaily)
      .mockReturnValueOnce([
        {
          date: '2026-03-19',
          messageCount: 1,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          cacheReadTokens: 50,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0.03,
        },
      ])
      .mockReturnValueOnce([
        {
          date: '2026-03-20',
          messageCount: 2,
          inputTokens: 200,
          outputTokens: 40,
          totalTokens: 240,
          cacheReadTokens: 70,
          cacheWriteTokens: 0,
          reasoningTokens: 8,
          estimatedCostUsd: 0.05,
        },
      ]);

    vi.mocked(chatUsageDb.listChatUsageMonthly).mockReturnValue([
      {
        month: '2026-03',
        messageCount: 3,
        inputTokens: 300,
        outputTokens: 60,
        totalTokens: 360,
        cacheReadTokens: 120,
        cacheWriteTokens: 0,
        reasoningTokens: 10,
        estimatedCostUsd: 0.08,
      },
    ]);

    const usage = createChatUsage();
    const summary = usage.getUsageSummary('7d');

    expect(summary.period).toBe('7d');
    expect(summary.from).toBe('2026-03-14T00:00:00.000Z');
    expect(summary.to).toBe('2026-03-20T12:00:00.000Z');
    expect(summary.totals.totalTokens).toBe(360);
    expect(summary.daily).toHaveLength(1);
    expect(summary.monthly).toHaveLength(1);
    expect(summary.heatmap).toHaveLength(365);

    const lastDay = summary.heatmap[summary.heatmap.length - 1];
    expect(lastDay).toEqual({
      date: '2026-03-20',
      totalTokens: 240,
      messageCount: 2,
    });

    const firstDay = summary.heatmap[0];
    expect(firstDay).toEqual({
      date: '2025-03-21',
      totalTokens: 0,
      messageCount: 0,
    });
  });
});
