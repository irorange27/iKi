import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/db/database', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '@iki/backend/db/database';
import { addChatUsageEvent } from '@iki/backend/db/chat_usage';

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
});
