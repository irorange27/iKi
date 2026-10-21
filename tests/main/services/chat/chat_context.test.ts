/* eslint-disable @typescript-eslint/no-non-null-assertion */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  getAssistantProfileContextMessageMock,
  retrieveRelevantContinuityMock,
  getClipboardContextMessageMock,
  getThreadWorkspaceSelectionMock,
} = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(),
  getChatMessagesMock: vi.fn(),
  getThreadContextMock: vi.fn(),
  upsertThreadContextMock: vi.fn(),
  deleteThreadContextMock: vi.fn(),
  extractTextFromMessageJsonMock: vi.fn(),
  generateThreadSummaryMock: vi.fn(),
  resolveSkillsSystemPromptMock: vi.fn(),
  getAssistantProfileContextMessageMock: vi.fn(),
  retrieveRelevantContinuityMock: vi.fn(),
  getClipboardContextMessageMock: vi.fn(),
  getThreadWorkspaceSelectionMock: vi.fn(() => null),
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@iki/backend/workspaces/thread_workspace', () => ({
  getThreadWorkspaceSelection: getThreadWorkspaceSelectionMock,
}));

vi.mock('@iki/backend/db/chat_message', () => ({
  getChatMessages: getChatMessagesMock,
}));

vi.mock('@iki/backend/db/thread_context', () => ({
  getThreadContext: getThreadContextMock,
  upsertThreadContext: upsertThreadContextMock,
  deleteThreadContext: deleteThreadContextMock,
}));

vi.mock('@iki/backend/runtimes/thread_summary', () => ({
  generateThreadSummary: generateThreadSummaryMock,
}));

vi.mock('@iki/backend/thread_session/skills', () => ({
  resolveSkillsSystemPrompt: resolveSkillsSystemPromptMock,
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
  getAssistantProfileContextMessage: getAssistantProfileContextMessageMock,
  retrieveRelevantContinuity: retrieveRelevantContinuityMock,
  // Kept as a sentinel mock so the regression below also fails if context
  // assembly starts depending on a clipboard platform hook again.
  getClipboardContextMessage: getClipboardContextMessageMock,
}));

import { createChatContextAssembler } from '@iki/backend/turn_prep/context';

const baseConfig = {
  context: {
    enabled: true,
    recentMessageCount: 3,
    maxRecentTokens: 4000,
    maxMessageTokens: 200,
    maxIdentityTokens: 120,
    summaryTriggerMessages: 5,
    summaryRecentMessages: 2,
    maxSummaryTokens: 300,
    maxSkillTokens: 80,
  },
};

const makeStoredMessage = (role: 'user' | 'assistant', content: string) => ({
  message: JSON.stringify({ role, content }),
});

// The three thread_session capabilities the assembler consumes as injected
// ports. The vi.mock blocks above are only a tripwire (the clipboard sentinel
// test exercises them); the actual enforcement for "no direct thread_session
// import in turn_prep" is the arch rule turn-prep-below-session.
const contextPortDoubles = () => ({
  resolveSkillsSystemPrompt: resolveSkillsSystemPromptMock,
  getAssistantProfileContextMessage: getAssistantProfileContextMessageMock,
  retrieveRelevantContinuity: retrieveRelevantContinuityMock,
});

const createAssembler = () => ({
  assembler: createChatContextAssembler(contextPortDoubles()),
});

const findBlock = (result: { report: { blocks: Array<{ kind: string }> } }, kind: string) =>
  result.report.blocks.find(block => block.kind === kind);

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue(baseConfig);
  getChatMessagesMock.mockReturnValue([]);
  getThreadContextMock.mockReturnValue(null);
  generateThreadSummaryMock.mockResolvedValue({
    summary: 'Rolled summary of the earlier conversation.',
    model: { providerType: 'openai', model: 'gpt-4o-mini' },
  });
  resolveSkillsSystemPromptMock.mockResolvedValue({
    skillsSystemPrompt: '',
    usedSkills: [],
    skillMode: 'manual',
  });
  getAssistantProfileContextMessageMock.mockReturnValue('');
  retrieveRelevantContinuityMock.mockReturnValue(null);
});

describe('chat_context assembler', () => {
  it('returns the original messages unchanged when context assembly is disabled', async () => {
    const { assembler } = createAssembler();
    const messages = [
      { role: 'system', content: 'Preserved system message.' },
      { role: 'user', content: 'Current prompt.' },
    ] as const;

    const result = await assembler.assemble({
      contextBudgetOverride: { ...baseConfig.context, enabled: false },
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
  });

  it('does not read clipboard history or inject it into agent context', async () => {
    getClipboardContextMessageMock.mockReturnValue('clipboard_secret_sentinel');
    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
      threadId: 'thread_without_clipboard',
      messages: [{ role: 'user', content: 'Answer this question.' }],
    });

    expect(getClipboardContextMessageMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result.messages)).not.toContain('clipboard_secret_sentinel');
    expect(result.report.blocks.map(block => block.kind)).not.toContain('clipboard');
  });

  it('inserts assembled system blocks after preserved system prompts and before conversation turns', async () => {
    getAssistantProfileContextMessageMock.mockReturnValue('Identity block.');
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

    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
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
      { role: 'system', content: 'Use the planning skill.' },
      { role: 'assistant', content: 'Previous reply.' },
      { role: 'user', content: 'Plan the next step.' },
    ]);
  });

  // Prompt caching is a prefix: anything that changes before the transcript
  // forces the whole history to be re-prefilled. Per-turn volatile context must
  // therefore not sit in the system prefix.
  it('preserves old and new prompts until the model budget boundary', async () => {
    const assembler = createChatContextAssembler(contextPortDoubles());

    const latestPrompt =
      'this is the full current user prompt and it should remain intact even when it is long';
    const result = await assembler.assemble({
      contextBudgetOverride: { ...baseConfig.context, recentMessageCount: 2, maxMessageTokens: 5 },
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
        status: 'included',
      })
    );
  });

  it('preserves structured history until the model budget boundary', async () => {
    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      contextBudgetOverride: { ...baseConfig.context, recentMessageCount: 2, maxMessageTokens: 5 },
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
      content: [
        { type: 'text', text: 'older assistant context that is far too long to keep in full form' },
      ],
    });
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: 'Keep the final prompt intact.',
    });
    expect(findBlock(result, 'recent-history')).toEqual(
      expect.objectContaining({
        kind: 'recent-history',
        status: 'included',
      })
    );
  });

  it('preserves anchored tool messages without clipping them through the recent-history window', async () => {
    const { assembler } = createAssembler();
    const assistantToolCallMessage = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'web', input: {} }],
    } as never;
    const toolMessage = {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call_1', output: 'Important tool result' }],
    } as never;

    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
      messages: [
        assistantToolCallMessage,
        toolMessage,
        { role: 'user', content: 'Use the tool output.' },
      ],
    });

    expect(result.messages).toContainEqual(toolMessage);
    expect(result.messages).toContainEqual(assistantToolCallMessage);
    expect(findBlock(result, 'recent-history')).toEqual(
      expect.objectContaining({
        kind: 'recent-history',
        status: 'included',
        sourceCount: 3,
      })
    );
  });

  it('keeps the assistant tool call with its tool result when the recent-history window lands on that boundary', async () => {
    const { assembler } = createAssembler();
    const assistantToolCallMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'web', input: { q: 'hello' } },
      ],
    } as never;
    const toolResultMessage = {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call_1', output: { ok: true } }],
    } as never;
    const latestUserMessage = { role: 'user', content: 'Use that result.' };

    const result = await assembler.assemble({
      contextBudgetOverride: { ...baseConfig.context, recentMessageCount: 2 },
      messages: [assistantToolCallMessage, toolResultMessage, latestUserMessage],
    });

    expect(result.messages).toEqual([
      assistantToolCallMessage,
      toolResultMessage,
      latestUserMessage,
    ]);
    expect(findBlock(result, 'recent-history')).toEqual(
      expect.objectContaining({
        kind: 'recent-history',
        status: 'included',
        sourceCount: 3,
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
      contextBudgetOverride: baseConfig.context,
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

  it('drops confounding context blocks in benchmark clean mode', async () => {
    getAssistantProfileContextMessageMock.mockReturnValue('Identity.');

    const { assembler } = createAssembler({
      getAffectContextMessage: vi.fn(() => 'Stored affect.'),
    });

    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
      threadId: 'thread_clean',
      contextMode: 'benchmark_clean',
      messages: [{ role: 'user', content: 'Respond.' }],
      skillMode: 'auto',
    });

    expect(findBlock(result, 'identity')).toEqual(
      expect.objectContaining({
        kind: 'identity',
        status: 'dropped',
        reason: 'disabled for benchmark clean mode',
      })
    );
    expect(findBlock(result, 'thread-summary')).toEqual(
      expect.objectContaining({
        kind: 'thread-summary',
        status: 'dropped',
      })
    );
    expect(findBlock(result, 'skills')).toEqual(
      expect.objectContaining({
        kind: 'skills',
        status: 'dropped',
        reason: 'disabled for benchmark clean mode',
      })
    );
  });

  it('reports when no skills are selected for the current turn', async () => {
    const { assembler } = createAssembler();

    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
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
    const contextBudgetOverride = { ...baseConfig.context, maxSkillTokens: 4 };
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
      contextBudgetOverride,
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

  it('injects the active identity block through the shared context pipeline', async () => {
    getAssistantProfileContextMessageMock.mockReturnValue(
      'Identity profile for iKi:\n- Core role: grounded personal AI companion.'
    );

    const assembler = createChatContextAssembler(contextPortDoubles());

    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
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
      ...contextPortDoubles(),
      workspaceSystemMessage,
    });

    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
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

  it.each(['AGENTS.md', 'IKI.md'])(
    'loads complete %s instructions, preferring AGENTS.md over the legacy file',
    async filename => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-ikitest-'));
      try {
        const ikiContent = [
          '# Instructions',
          'preserve this constraint '.repeat(1000),
          '',
          'Always ask before writing to any file. Prefer read-only operations during exploration.',
        ].join('\n');
        fs.writeFileSync(path.join(tmpDir, 'IKI.md'), 'Legacy instructions');
        fs.writeFileSync(path.join(tmpDir, filename), ikiContent);

        getThreadWorkspaceSelectionMock.mockReturnValue({
          threadId: 'thread_iki_md',
          workspaceId: 'ws_iki_md',
          workspace: {
            id: 'ws_iki_md',
            path: tmpDir,
            name: 'Test',
            is_temporary: 1,
            show_in_list: 0,
          },
        } as never);

        const { assembler } = createAssembler();
        const result = await assembler.assemble({
          contextBudgetOverride: baseConfig.context,
          threadId: 'thread_iki_md',
          messages: [{ role: 'user', content: 'What are the instructions?' }],
        });

        const identityMessage = result.messages.find(
          message =>
            message.role === 'system' &&
            typeof message.content === 'string' &&
            message.content.includes(filename)
        );
        expect(identityMessage).toBeTruthy();
        expect(String(identityMessage!.content)).toContain(ikiContent);
        expect(String(identityMessage!.content)).not.toContain('Legacy instructions');
        expect(String(identityMessage!.content)).toContain('Always ask before writing to any file');
        expect(findBlock(result, 'identity')).toEqual(
          expect.objectContaining({
            kind: 'identity',
            status: 'included',
          })
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it('gracefully handles missing IKI.md without altering the identity block', async () => {
    getThreadWorkspaceSelectionMock.mockReturnValue({
      threadId: 'thread_no_iki',
      workspaceId: 'ws_no_iki',
      workspace: {
        id: 'ws_no_iki',
        path: '/tmp/nonexistent-iki-test',
        name: 'Test',
        is_temporary: 1,
        show_in_list: 0,
      },
    } as never);

    getAssistantProfileContextMessageMock.mockReturnValue(
      'Identity profile for iKi:\n- Core role: grounded personal AI companion.'
    );

    const { assembler } = createAssembler();
    const result = await assembler.assemble({
      contextBudgetOverride: baseConfig.context,
      threadId: 'thread_no_iki',
      messages: [{ role: 'user', content: 'Who are you?' }],
    });

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: 'Identity profile for iKi:\n- Core role: grounded personal AI companion.',
    });
    expect(
      result.messages.some(
        message => typeof message.content === 'string' && message.content.includes('IKI.md')
      )
    ).toBe(false);
  });
});
