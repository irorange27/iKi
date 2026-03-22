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

type MemoryDoubles = {
  retrieveRelevantMemory: ReturnType<typeof vi.fn>;
  getAffectContextMessage: ReturnType<typeof vi.fn>;
};

const createAssembler = (memoryOverrides: Partial<MemoryDoubles> = {}) => {
  const memory: MemoryDoubles = {
    retrieveRelevantMemory: vi.fn(() => null),
    getAffectContextMessage: vi.fn(() => ''),
    ...memoryOverrides,
  };

  return {
    assembler: createChatContextAssembler({ memory: memory as never }),
    memory,
  };
};

const findBlock = (result: { report: { blocks: Array<{ kind: string }> } }, kind: string) =>
  result.report.blocks.find(block => block.kind === kind);

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
});

describe('chat_context assembler', () => {
  it('returns the original messages unchanged when context assembly is disabled', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        context: {
          ...baseConfig.memory.context,
          enabled: false,
        },
      },
    });

    const { assembler, memory } = createAssembler();
    const messages = [
      { role: 'system', content: 'Preserved system message.' },
      { role: 'user', content: 'Current prompt.' },
    ] as const;

    const result = await assembler.assemble({
      threadId: 'thread_disabled',
      messages: [...messages],
      skillMode: 'auto',
    });

    expect(result.messages).toEqual(messages);
    expect(result.usedSkills).toEqual([]);
    expect(result.skillMode).toBe('auto');
    expect(result.report).toEqual({
      totalEstimatedTokens: 0,
      retainedRecentMessages: 1,
      compactedMessages: 0,
      blocks: [],
    });
    expect(getChatMessagesMock).not.toHaveBeenCalled();
    expect(resolveSkillsSystemPromptMock).not.toHaveBeenCalled();
    expect(memory.retrieveRelevantMemory).not.toHaveBeenCalled();
    expect(memory.getAffectContextMessage).not.toHaveBeenCalled();
  });

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
    const memoryPayload = onMemoryRetrieved.mock.calls[0]?.[0];
    const retrievedIds = Array.isArray(memoryPayload?.results)
      ? memoryPayload.results.map((entry: { id?: string }) => entry.id)
      : [];

    expect(memoryBlock).toEqual(
      expect.objectContaining({
        kind: 'memory',
        status: 'truncated',
        sourceCount: retrievedIds.length,
        reason: 'memory items reduced to fit context budget',
      })
    );
    expect(retrievedIds.length).toBeGreaterThan(0);
    expect(retrievedIds.length).toBeLessThan(3);
    expect(onMemoryRetrieved).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'project constraints',
        results: expect.arrayContaining([
          expect.objectContaining({
            id: 'mem_1',
          }),
        ]),
      })
    );
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        role: 'system',
      })
    );
    expect(String(result.messages[0].content)).toContain('Long-term memory');
  });

  it('inserts assembled system blocks after preserved system prompts and before conversation turns', async () => {
    getIdentityContextMessageMock.mockReturnValue('Identity block.');
    resolveSkillsSystemPromptMock.mockResolvedValue({
      skillsSystemPrompt: 'Use the planning skill.',
      usedSkills: [
        {
          id: 'skill_planner',
          name: 'Planner',
          description: 'Plans next steps.',
          source: 'user',
        },
      ],
      skillMode: 'auto',
    });

    const { assembler } = createAssembler({
      retrieveRelevantMemory: vi.fn(() => ({
        query: 'Plan the next step.',
        results: [{ id: 'mem_1', summary: 'Remember the design goal.', score: 0.9 }],
        systemMessage: '',
      })),
      getAffectContextMessage: vi.fn(() => 'Affect block.'),
    });

    const result = await assembler.assemble({
      threadId: 'thread_ordering',
      skillMode: 'auto',
      messages: [
        { role: 'system', content: 'Existing system A.' },
        { role: 'system', content: 'Existing system B.' },
        { role: 'assistant', content: 'Previous reply.' },
        { role: 'user', content: 'Plan the next step.' },
      ],
    });

    expect(result.messages).toEqual([
      { role: 'system', content: 'Existing system A.' },
      { role: 'system', content: 'Existing system B.' },
      { role: 'system', content: 'Identity block.' },
      {
        role: 'system',
        content:
          'Long-term memory (use only if relevant; ignore if unrelated):\n- (0.900) Remember the design goal.',
      },
      { role: 'system', content: 'Affect block.' },
      { role: 'system', content: 'Use the planning skill.' },
      { role: 'assistant', content: 'Previous reply.' },
      { role: 'user', content: 'Plan the next step.' },
    ]);
  });

  it('drops memory retrieval when the latest prompt is unavailable', async () => {
    const retrieveRelevantMemory = vi.fn(() => ({
      query: 'ignored',
      results: [{ id: 'mem_1', summary: 'unused', score: 0.5 }],
      systemMessage: '',
    }));
    const { assembler } = createAssembler({ retrieveRelevantMemory });

    const result = await assembler.assemble({
      threadId: 'thread_no_query',
      messages: [{ role: 'assistant', content: 'Waiting for a user request.' }],
    });

    expect(retrieveRelevantMemory).not.toHaveBeenCalled();
    expect(findBlock(result, 'memory')).toEqual(
      expect.objectContaining({
        kind: 'memory',
        status: 'dropped',
        reason: 'no user query available',
      })
    );
  });

  it('drops thread-scoped memory and stored affect when no thread id is available', async () => {
    const retrieveRelevantMemory = vi.fn();
    const getAffectContextMessage = vi.fn(() => 'Stored affect.');
    const { assembler } = createAssembler({
      retrieveRelevantMemory,
      getAffectContextMessage,
    });

    const result = await assembler.assemble({
      messages: [{ role: 'user', content: 'What changed?' }],
    });

    expect(retrieveRelevantMemory).not.toHaveBeenCalled();
    expect(getAffectContextMessage).not.toHaveBeenCalled();
    expect(findBlock(result, 'memory')).toEqual(
      expect.objectContaining({
        kind: 'memory',
        status: 'dropped',
        reason: 'no relevant memory retrieved',
      })
    );
    expect(findBlock(result, 'affect')).toEqual(
      expect.objectContaining({
        kind: 'affect',
        status: 'dropped',
        reason: 'no affect context available',
      })
    );
  });

  it('clips a single oversized memory block to the configured budget', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        context: {
          ...baseConfig.memory.context,
          maxMemoryTokens: 10,
        },
      },
    });

    const onMemoryRetrieved = vi.fn();
    const { assembler } = createAssembler({
      retrieveRelevantMemory: vi.fn(() => ({
        query: 'Need memory context.',
        results: [{ id: 'mem_1', summary: 'alpha '.repeat(30), score: 0.9 }],
        systemMessage: '',
      })),
    });

    const result = await assembler.assemble({
      threadId: 'thread_memory_clip',
      messages: [{ role: 'user', content: 'Need memory context.' }],
      onMemoryRetrieved,
    });

    expect(findBlock(result, 'memory')).toEqual(
      expect.objectContaining({
        kind: 'memory',
        status: 'truncated',
        reason: 'memory block clipped to context budget',
        sourceCount: 1,
      })
    );
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: expect.stringMatching(/\.\.\.$/),
    });
    expect(onMemoryRetrieved).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Need memory context.',
        results: [expect.objectContaining({ id: 'mem_1' })],
        systemMessage: expect.stringMatching(/\.\.\.$/),
      })
    );
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

  it('clips oversized rich-text recent messages into a bounded plain-text history entry', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        context: {
          ...baseConfig.memory.context,
          recentMessageCount: 2,
          maxMessageTokens: 5,
        },
      },
    });

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'older assistant context that is far too long to keep in full form',
            },
          ] as never,
        },
        { role: 'user', content: 'Keep the final prompt intact.' },
      ],
    });

    expect(result.messages[0]).toEqual({
      role: 'assistant',
      content: expect.stringMatching(/\.\.\.$/),
    });
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: 'Keep the final prompt intact.',
    });
    expect(findBlock(result, 'recent-history')).toEqual(
      expect.objectContaining({
        kind: 'recent-history',
        status: 'truncated',
        reason: 'clipped oversized recent text',
      })
    );
  });

  it('preserves tool messages without clipping them through the recent-history window', async () => {
    const { assembler } = createAssembler();
    const toolMessage = {
      role: 'tool',
      content: { ok: true, output: 'Important tool result' },
    } as never;

    const result = await assembler.assemble({
      messages: [toolMessage, { role: 'user', content: 'Use the tool output.' }],
    });

    expect(result.messages).toContainEqual(toolMessage);
    expect(findBlock(result, 'recent-history')).toEqual(
      expect.objectContaining({
        kind: 'recent-history',
        status: 'included',
        sourceCount: 2,
      })
    );
  });

  it('keeps non-text structured message parts unchanged when they remain in recent history', async () => {
    const { assembler } = createAssembler();
    const multimodalAssistantMessage = {
      role: 'assistant',
      content: [{ type: 'image', image: 'https://example.com/mock.png' }],
    } as never;

    const result = await assembler.assemble({
      messages: [multimodalAssistantMessage, { role: 'user', content: 'Use the latest context.' }],
    });

    expect(result.messages).toContainEqual(multimodalAssistantMessage);
    expect(findBlock(result, 'recent-history')).toEqual(
      expect.objectContaining({
        kind: 'recent-history',
        status: 'included',
        sourceCount: 2,
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

  it('prefers realtime affect over stored affect state', async () => {
    const getAffectContextMessage = vi.fn(() => 'Stored affect.');
    const { assembler } = createAssembler({ getAffectContextMessage });

    const result = await assembler.assemble({
      threadId: 'thread_affect',
      realtimeAffectMessage: '  Realtime affect.  ',
      messages: [{ role: 'user', content: 'Respond.' }],
    });

    expect(getAffectContextMessage).not.toHaveBeenCalled();
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Realtime affect.',
    });
    expect(findBlock(result, 'affect')).toEqual(
      expect.objectContaining({
        kind: 'affect',
        status: 'included',
      })
    );
  });

  it('reports when no skills are selected for the current turn', async () => {
    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      threadId: 'thread_no_skills',
      messages: [{ role: 'user', content: 'Respond.' }],
    });

    expect(result.usedSkills).toEqual([]);
    expect(findBlock(result, 'skills')).toEqual(
      expect.objectContaining({
        kind: 'skills',
        status: 'dropped',
        reason: 'no skills selected',
        sourceCount: 0,
      })
    );
  });

  it('clips oversized skill prompts to the configured budget', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        context: {
          ...baseConfig.memory.context,
          maxSkillTokens: 4,
        },
      },
    });
    resolveSkillsSystemPromptMock.mockResolvedValue({
      skillsSystemPrompt: 'Use the ultra detailed research and planning skill.',
      usedSkills: [
        {
          id: 'skill_research',
          name: 'Research',
          description: 'Deep research support.',
          source: 'user',
        },
      ],
      skillMode: 'auto',
    });

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      threadId: 'thread_skill_clip',
      skillMode: 'auto',
      messages: [{ role: 'user', content: 'Plan it.' }],
    });

    expect(result.skillMode).toBe('auto');
    expect(result.usedSkills).toEqual([
      expect.objectContaining({
        id: 'skill_research',
      }),
    ]);
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: expect.stringMatching(/\.\.\.$/),
    });
    expect(findBlock(result, 'skills')).toEqual(
      expect.objectContaining({
        kind: 'skills',
        status: 'truncated',
        reason: 'skill context clipped to budget',
        sourceCount: 1,
      })
    );
  });

  it('reuses an already up-to-date persisted thread summary without regenerating it', async () => {
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
    getThreadContextMock.mockReturnValue({
      thread_id: 'thread_summary_reuse',
      summary: 'Existing summary.',
      covered_message_count: 6,
      metadata: {},
    });

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      threadId: 'thread_summary_reuse',
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

    expect(generateThreadSummaryMock).not.toHaveBeenCalled();
    expect(upsertThreadContextMock).not.toHaveBeenCalled();
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Thread summary:\nExisting summary.',
    });
    expect(findBlock(result, 'thread-summary')).toEqual(
      expect.objectContaining({
        kind: 'thread-summary',
        status: 'included',
        sourceCount: 6,
      })
    );
  });

  it('keeps the stale persisted summary when incremental regeneration fails', async () => {
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
    getThreadContextMock.mockReturnValue({
      thread_id: 'thread_summary_stale',
      summary: 'Existing summary.',
      covered_message_count: 4,
      metadata: {},
    });
    generateThreadSummaryMock.mockResolvedValue(null);

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      threadId: 'thread_summary_stale',
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

    expect(generateThreadSummaryMock).toHaveBeenCalledWith({
      existingSummary: 'Existing summary.',
      messages: [
        { role: 'user', content: 'u3' },
        { role: 'assistant', content: 'a3' },
      ],
    });
    expect(upsertThreadContextMock).not.toHaveBeenCalled();
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Thread summary:\nExisting summary.',
    });
    expect(findBlock(result, 'thread-summary')).toEqual(
      expect.objectContaining({
        kind: 'thread-summary',
        status: 'included',
        sourceCount: 6,
      })
    );
  });

  it('reports summary unavailability when regeneration fails without an existing summary', async () => {
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
    generateThreadSummaryMock.mockResolvedValue(null);

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      threadId: 'thread_summary_unavailable',
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

    expect(upsertThreadContextMock).not.toHaveBeenCalled();
    expect(result.messages[0]).toEqual({
      role: 'assistant',
      content: 'a3',
    });
    expect(findBlock(result, 'thread-summary')).toEqual(
      expect.objectContaining({
        kind: 'thread-summary',
        status: 'dropped',
        reason: 'summary unavailable',
      })
    );
  });

  it('regenerates the thread summary from scratch when the persisted coverage is ahead of the compactable window', async () => {
    const storedRows = [
      makeStoredMessage('user', 'u1'),
      makeStoredMessage('assistant', 'a1'),
      makeStoredMessage('user', 'u2'),
      makeStoredMessage('assistant', 'a2'),
      makeStoredMessage('user', 'u3'),
      makeStoredMessage('assistant', 'a3'),
    ];
    getChatMessagesMock.mockReturnValue(storedRows as never[]);
    getThreadContextMock.mockReturnValue({
      thread_id: 'thread_summary_regen',
      summary: 'Too-far-ahead summary.',
      covered_message_count: 5,
      metadata: {},
    });
    generateThreadSummaryMock.mockResolvedValue({
      summary: 'Regenerated summary.',
      model: { providerType: 'openai', model: 'gpt-4o-mini' },
    });

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      threadId: 'thread_summary_regen',
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u3' },
        { role: 'assistant', content: 'a3' },
      ],
    });

    expect(generateThreadSummaryMock).toHaveBeenCalledWith({
      existingSummary: '',
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ],
    });
    expect(upsertThreadContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread_summary_regen',
        summary: 'Regenerated summary.',
        covered_message_count: 4,
      })
    );
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Thread summary:\nRegenerated summary.',
    });
  });

  it('deletes persisted thread summaries when there is nothing compactable anymore', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        context: {
          ...baseConfig.memory.context,
          summaryTriggerMessages: 1,
          summaryRecentMessages: 4,
        },
      },
    });
    getChatMessagesMock.mockReturnValue([makeStoredMessage('user', 'u1')] as never[]);
    getThreadContextMock.mockReturnValue({
      thread_id: 'thread_summary_delete',
      summary: 'Old summary.',
      covered_message_count: 1,
      metadata: {},
    });

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      threadId: 'thread_summary_delete',
      messages: [{ role: 'user', content: 'u1' }],
    });

    expect(deleteThreadContextMock).toHaveBeenCalledWith('thread_summary_delete');
    expect(generateThreadSummaryMock).not.toHaveBeenCalled();
    expect(upsertThreadContextMock).not.toHaveBeenCalled();
    expect(findBlock(result, 'thread-summary')).toEqual(
      expect.objectContaining({
        kind: 'thread-summary',
        status: 'dropped',
        reason: 'thread too short for summarization',
      })
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

  it('injects workspace scope through the shared identity block without hard-coupling tests to workspace storage', async () => {
    const workspaceSystemMessage = vi.fn(
      () => 'Workspace scope:\n- Active workspace: /Users/nina/Developer/MyRepo/iki'
    );

    const assembler = createChatContextAssembler({
      memory: {
        retrieveRelevantMemory: vi.fn(() => null),
        getAffectContextMessage: vi.fn(() => ''),
      } as never,
      workspaceSystemMessage,
    });

    const result = await assembler.assemble({
      threadId: 'thread_workspace',
      messages: [{ role: 'user', content: 'list project files' }],
    });

    expect(workspaceSystemMessage).toHaveBeenCalledWith('thread_workspace');
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Workspace scope:\n- Active workspace: /Users/nina/Developer/MyRepo/iki',
    });
    expect(findBlock(result, 'identity')).toEqual(
      expect.objectContaining({
        kind: 'identity',
        status: 'included',
      })
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
