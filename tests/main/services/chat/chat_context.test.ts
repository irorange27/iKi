import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAppConfigMock,
  getChatMessagesMock,
  getThreadContextMock,
  upsertThreadContextMock,
  deleteThreadContextMock,
  extractTextFromMessageJsonMock,
  generateThreadSummaryMock,
  resolveSkillsSystemPromptMock,
} = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(),
  getChatMessagesMock: vi.fn(),
  getThreadContextMock: vi.fn(),
  upsertThreadContextMock: vi.fn(),
  deleteThreadContextMock: vi.fn(),
  extractTextFromMessageJsonMock: vi.fn(),
  generateThreadSummaryMock: vi.fn(),
  resolveSkillsSystemPromptMock: vi.fn(),
}));

vi.mock('../../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../../src/core/db/chat_message', () => ({
  getChatMessages: getChatMessagesMock,
}));

vi.mock('../../../../src/core/db/thread_context', () => ({
  getThreadContext: getThreadContextMock,
  upsertThreadContext: upsertThreadContextMock,
  deleteThreadContext: deleteThreadContextMock,
}));

vi.mock('../../../../src/core/db/memory', () => ({
  extractTextFromMessageJson: extractTextFromMessageJsonMock,
}));

vi.mock('../../../../src/core/context/thread_summary', () => ({
  generateThreadSummary: generateThreadSummaryMock,
}));

vi.mock('../../../../src/main/services/chat/chat_skills', () => ({
  resolveSkillsSystemPrompt: resolveSkillsSystemPromptMock,
}));

import { createChatContextAssembler } from '../../../../src/main/services/chat/chat_context';

const baseConfig = {
  memory: {
    context: {
      enabled: true,
      recentMessageCount: 3,
      maxRecentTokens: 4000,
      maxMessageTokens: 200,
      summaryTriggerMessages: 5,
      summaryRecentMessages: 2,
      maxSummaryTokens: 300,
      maxMemoryTokens: 40,
      maxSkillTokens: 80,
    },
  },
};

const makeStoredMessage = (role: 'user' | 'assistant', content: string) => ({
  message: JSON.stringify({ role, content }),
});

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue(baseConfig);
  getChatMessagesMock.mockReturnValue([]);
  getThreadContextMock.mockReturnValue(null);
  extractTextFromMessageJsonMock.mockImplementation((json: string) => JSON.parse(json));
  generateThreadSummaryMock.mockResolvedValue({
    summary: 'Rolled summary of the earlier conversation.',
    model: { providerType: 'openai', model: 'gpt-4o-mini' },
  });
  resolveSkillsSystemPromptMock.mockResolvedValue({
    skillsSystemPrompt: '',
    usedSkills: [],
    skillMode: 'manual',
  });
});

describe('chat_context assembler', () => {
  it('compacts long threads into a persisted summary plus recent raw turns', async () => {
    const storedRows = [
      makeStoredMessage('user', 'u1'),
      makeStoredMessage('assistant', 'a1'),
      makeStoredMessage('user', 'u2'),
      makeStoredMessage('assistant', 'a2'),
      makeStoredMessage('user', 'u3'),
      makeStoredMessage('assistant', 'a3'),
      makeStoredMessage('user', 'u4'),
      makeStoredMessage('assistant', 'a4'),
    ];
    getChatMessagesMock.mockReturnValue(storedRows as never[]);

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
    });

    const result = await assembler.assemble({
      threadId: 'thread_1',
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u3' },
        { role: 'assistant', content: 'a3' },
        { role: 'user', content: 'u4' },
        { role: 'assistant', content: 'a4' },
      ],
    });

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Thread summary:\nRolled summary of the earlier conversation.',
    });
    expect(result.messages.slice(1)).toEqual([
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'u4' },
      { role: 'assistant', content: 'a4' },
    ]);
    expect(result.report.retainedRecentMessages).toBe(3);
    expect(result.report.compactedMessages).toBe(5);
    expect(result.report.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'thread-summary',
          status: 'included',
          sourceCount: 6,
        }),
      ])
    );
    expect(upsertThreadContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread_1',
        covered_message_count: 6,
      })
    );
  });

  it('reduces retrieved memory to fit the configured budget and reports the truncation', async () => {
    const onMemoryRetrieved = vi.fn();
    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => ({
          query: 'project constraints',
          results: [
            { id: 'mem_1', summary: 'alpha alpha alpha alpha alpha alpha', score: 0.9 },
            { id: 'mem_2', summary: 'beta beta beta beta beta beta', score: 0.8 },
            { id: 'mem_3', summary: 'gamma gamma gamma gamma gamma gamma', score: 0.7 },
          ],
          systemMessage: '',
        })),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
    });

    const result = await assembler.assemble({
      threadId: 'thread_2',
      messages: [{ role: 'user', content: 'project constraints' }],
      onMemoryRetrieved,
    });

    const memoryBlock = result.report.blocks.find(block => block.kind === 'memory');
    expect(memoryBlock).toEqual(
      expect.objectContaining({
        kind: 'memory',
        status: 'truncated',
        sourceCount: 2,
      })
    );
    expect(onMemoryRetrieved).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'project constraints',
        results: [
          expect.objectContaining({
            id: 'mem_1',
          }),
          expect.objectContaining({
            id: 'mem_2',
          }),
        ],
      })
    );
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        role: 'system',
      })
    );
    expect(String(result.messages[0].content)).toContain('Long-term memory');
  });

  it('never clips the latest user prompt even when older turns are clipped', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        context: {
          ...baseConfig.memory.context,
          recentMessageCount: 2,
          maxMessageTokens: 5,
        },
      },
    });

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
    });

    const latestPrompt =
      'this is the full current user prompt and it should remain intact even when it is long';
    const result = await assembler.assemble({
      threadId: 'thread_3',
      messages: [
        {
          role: 'assistant',
          content: 'older assistant context that should be clipped because it is very long',
        },
        {
          role: 'user',
          content: latestPrompt,
        },
      ],
    });

    expect(result.messages[result.messages.length - 1]).toEqual({
      role: 'user',
      content: latestPrompt,
    });
    expect(result.report.blocks.find(block => block.kind === 'recent-history')).toEqual(
      expect.objectContaining({
        status: 'truncated',
      })
    );
  });
});
