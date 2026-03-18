import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: vi.fn(),
}));

vi.mock('../../../src/core/agent', () => ({
  SimpleAgent: vi.fn(),
}));

import { getToolModel } from '../../../src/core/provider/tool_model';
import { SimpleAgent } from '../../../src/core/agent';
import { generateLongMemorySummary } from '../../../src/core/memory/auto_summarize';
import type { ShortMemoryEntry } from '../../../src/core/db/memory';

const makeEntry = (overrides: Partial<ShortMemoryEntry>): ShortMemoryEntry => ({
  id: 'mems_1',
  thread_id: 'thread_1',
  message_id: 'msg_1',
  role: 'user',
  content: 'Base content',
  emotion: null,
  importance: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const getToolModelMock = vi.mocked(getToolModel);
const SimpleAgentMock = vi.mocked(SimpleAgent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateLongMemorySummary', () => {
  it('returns null when there are no entries', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });

    const result = await generateLongMemorySummary([]);

    expect(result).toBeNull();
    expect(SimpleAgentMock).not.toHaveBeenCalled();
  });

  it('returns null when transcript is too short', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });

    const result = await generateLongMemorySummary([
      makeEntry({ content: 'Too short.' }),
    ]);

    expect(result).toBeNull();
    expect(SimpleAgentMock).not.toHaveBeenCalled();
  });

  it('ignores NONE summaries', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: 'NONE' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const result = await generateLongMemorySummary([
      makeEntry({ content: 'The user likes tea and keeps a daily habit log.' }),
    ]);

    expect(result).toBeNull();
  });

  it('sanitizes summary text and returns source message ids', async () => {
    getToolModelMock.mockReturnValue({ providerType: 'openai', model: 'gpt-4o-mini' });
    SimpleAgentMock.mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({ response: '  "User prefers green tea."  ' }),
        }) as unknown as InstanceType<typeof SimpleAgent>
    );

    const entries: ShortMemoryEntry[] = [
      makeEntry({
        id: 'mems_2',
        message_id: 'msg_2',
        role: 'assistant',
        content: 'Assistant reply about tea options and timing.',
        updated_at: '2024-01-02T00:00:00.000Z',
      }),
      makeEntry({
        id: 'mems_1',
        message_id: 'msg_1',
        role: 'user',
        content: 'User says they prefer green tea and drink it every morning.',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
    ];

    const result = await generateLongMemorySummary(entries);

    expect(result?.summary).toBe('User prefers green tea.');
    expect(result?.sourceMessageIds).toEqual(['msg_1', 'msg_2']);
    expect(result?.model).toEqual({ providerType: 'openai', model: 'gpt-4o-mini' });
  });
});
