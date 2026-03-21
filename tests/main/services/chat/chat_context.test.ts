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
  getIdentityContextMessageMock,
  getRelationshipContextMessageMock,
  getLifeContextMessageMock,
  getRecentLifeReflectionContextMessageMock,
} = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(),
  getChatMessagesMock: vi.fn(),
  getThreadContextMock: vi.fn(),
  upsertThreadContextMock: vi.fn(),
  deleteThreadContextMock: vi.fn(),
  extractTextFromMessageJsonMock: vi.fn(),
  generateThreadSummaryMock: vi.fn(),
  resolveSkillsSystemPromptMock: vi.fn(),
  getIdentityContextMessageMock: vi.fn(),
  getRelationshipContextMessageMock: vi.fn(),
  getLifeContextMessageMock: vi.fn(),
  getRecentLifeReflectionContextMessageMock: vi.fn(),
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

vi.mock('../../../../src/main/services/identity/identity_service', () => ({
  getIdentityContextMessage: getIdentityContextMessageMock,
}));

vi.mock('../../../../src/main/services/relationship/relationship_service', () => ({
  getRelationshipContextMessage: getRelationshipContextMessageMock,
}));

vi.mock('../../../../src/main/services/life/life_runtime', () => ({
  getLifeContextMessage: getLifeContextMessageMock,
}));

vi.mock('../../../../src/main/services/life/life_reflection', () => ({
  getRecentLifeReflectionContextMessage: getRecentLifeReflectionContextMessageMock,
}));

import { createChatContextAssembler } from '../../../../src/main/services/chat/chat_context';

const baseConfig = {
  memory: {
    context: {
      enabled: true,
      recentMessageCount: 3,
      maxRecentTokens: 4000,
      maxMessageTokens: 200,
      maxIdentityTokens: 120,
      maxRelationshipTokens: 120,
      maxLifeStateTokens: 120,
      maxReflectionTokens: 120,
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
  getIdentityContextMessageMock.mockReturnValue('');
  getRelationshipContextMessageMock.mockReturnValue('');
  getLifeContextMessageMock.mockReturnValue('');
  getRecentLifeReflectionContextMessageMock.mockReturnValue('');
  getLifeContextMessageMock.mockReturnValue('');
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

  it('reuses the shared affect and skills path when memory retrieval is unavailable', async () => {
    resolveSkillsSystemPromptMock.mockResolvedValue({
      skillsSystemPrompt: 'Use the writing skill.',
      usedSkills: [
        {
          id: 'skill_writer',
          name: 'Writer',
          description: 'Drafts polished copy.',
          source: 'user',
        },
      ],
      skillMode: 'auto',
    });

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => 'Current affect: focused and calm.'),
      } as never,
    });

    const result = await assembler.assemble({
      threadId: 'thread_4',
      messages: [
        { role: 'assistant', content: 'Existing assistant context.' },
        { role: 'user', content: 'Please draft a concise reply.' },
      ],
      skillMode: 'auto',
    });

    expect(result.messages.slice(0, 2)).toEqual([
      {
        role: 'system',
        content: 'Current affect: focused and calm.',
      },
      {
        role: 'system',
        content: 'Use the writing skill.',
      },
    ]);
    expect(result.usedSkills).toEqual([
      expect.objectContaining({
        id: 'skill_writer',
        name: 'Writer',
      }),
    ]);
    expect(result.skillMode).toBe('auto');
    expect(result.report.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'memory',
          status: 'dropped',
          reason: 'no relevant memory retrieved',
        }),
        expect.objectContaining({
          kind: 'affect',
          status: 'included',
        }),
        expect.objectContaining({
          kind: 'skills',
          status: 'included',
          sourceCount: 1,
        }),
      ])
    );
  });

  it('injects the active identity block through the shared context pipeline', async () => {
    getIdentityContextMessageMock.mockReturnValue(
      'Identity profile for iKi:\n- Core role: grounded personal AI companion.'
    );

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
    });

    const result = await assembler.assemble({
      threadId: 'thread_identity',
      messages: [{ role: 'user', content: 'What should we focus on next?' }],
    });

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Identity profile for iKi:\n- Core role: grounded personal AI companion.',
    });
    expect(result.report.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'identity',
          status: 'included',
        }),
      ])
    );
  });

  it('injects thread relationship context as a dedicated bounded block', async () => {
    getRelationshipContextMessageMock.mockReturnValue(
      'Relationship context for iKi:\n- Current thread: QQ Group 30003\n- Thread relationship: shared group context.'
    );

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
    });

    const result = await assembler.assemble({
      threadId: 'thread_group',
      messages: [{ role: 'user', content: 'summarize the discussion' }],
    });

    expect(result.messages).toContainEqual({
      role: 'system',
      content:
        'Relationship context for iKi:\n- Current thread: QQ Group 30003\n- Thread relationship: shared group context.',
    });
    expect(result.report.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'relationship',
          status: 'included',
        }),
      ])
    );
  });

  it('injects the current life-state block through the shared context pipeline', async () => {
    getLifeContextMessageMock.mockReturnValue(
      'Current life state for iKi:\n- Presence: focused\n- Activity: focused_work'
    );

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
    });

    const result = await assembler.assemble({
      threadId: 'thread_life',
      messages: [{ role: 'user', content: 'What are you occupied with?' }],
    });

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Current life state for iKi:\n- Presence: focused\n- Activity: focused_work',
    });
    expect(result.report.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'life-state',
          status: 'included',
        }),
      ])
    );
  });

  it('injects the recent reflection block through the shared context pipeline', async () => {
    getRecentLifeReflectionContextMessageMock.mockReturnValue(
      'Recent life reflection for iKi:\n- Hourly recap: task arc stayed coherent.'
    );

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
    });

    const result = await assembler.assemble({
      threadId: 'thread_reflection',
      messages: [{ role: 'user', content: 'Where are we in the day?' }],
    });

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Recent life reflection for iKi:\n- Hourly recap: task arc stayed coherent.',
    });
    expect(result.report.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'recent-reflection',
          status: 'included',
        }),
      ])
    );
  });
});
