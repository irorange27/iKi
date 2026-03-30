import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/core/db/chat_tool_approval', () => ({
  upsertChatToolApprovalSession: vi.fn(),
  upsertChatToolApprovals: vi.fn(),
  getChatToolApproval: vi.fn(),
  getChatToolApprovalSession: vi.fn(),
  getActiveChatToolApprovalsBySession: vi.fn(),
  answerChatToolApproval: vi.fn(),
  consumeChatToolApprovalSession: vi.fn(),
}));

vi.mock('../../../../src/core/db/chat_message', () => ({
  getChatMessages: vi.fn(),
}));

vi.mock('../../../../src/core/tools', () => ({
  defaultToolRegistry: {
    get: vi.fn(),
  },
}));

vi.mock('../../../../src/main/services/chat/chat_ui', () => ({
  createUiChunkEmitter: vi.fn(() => ({
    messageId: 'assistant_resume',
    emitTextDelta: vi.fn(),
    emitToolEvent: vi.fn(),
    emitMemoryRetrieval: vi.fn(),
    emitAffectSignal: vi.fn(),
    emitContextReport: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
    error: vi.fn(),
  })),
  parseStoredUiMessageRow: vi.fn(({ message }) => JSON.parse(message)),
  toModelInputMessages: vi.fn(async messages => messages),
}));

vi.mock('../../../../src/main/services/chat/chat_conversation_runner', () => ({
  createChatConversationRunner: vi.fn(),
}));

vi.mock('../../../../src/main/services/chat/chat_tool_loop', () => ({
  createToolLoopRunner: vi.fn(),
}));

import * as chatToolApprovalDb from '../../../../src/core/db/chat_tool_approval';
import * as chatMessageDb from '../../../../src/core/db/chat_message';
import { defaultToolRegistry } from '../../../../src/core/tools';
import { createChatApproval } from '../../../../src/main/services/chat/chat_approval';
import { createChatConversationRunner } from '../../../../src/main/services/chat/chat_conversation_runner';
import { createToolLoopRunner } from '../../../../src/main/services/chat/chat_tool_loop';

const createToolLoopRunnerMock = vi.mocked(createToolLoopRunner);
const createChatConversationRunnerMock = vi.mocked(createChatConversationRunner);
const getChatMessagesMock = vi.mocked(chatMessageDb.getChatMessages);
const defaultToolRegistryGetMock = vi.mocked(defaultToolRegistry.get);
const upsertChatToolApprovalSessionMock = vi.mocked(
  chatToolApprovalDb.upsertChatToolApprovalSession
);
const upsertChatToolApprovalsMock = vi.mocked(chatToolApprovalDb.upsertChatToolApprovals);
const getChatToolApprovalMock = vi.mocked(chatToolApprovalDb.getChatToolApproval);
const getChatToolApprovalSessionMock = vi.mocked(chatToolApprovalDb.getChatToolApprovalSession);
const getActiveChatToolApprovalsBySessionMock = vi.mocked(
  chatToolApprovalDb.getActiveChatToolApprovalsBySession
);
const answerChatToolApprovalMock = vi.mocked(chatToolApprovalDb.answerChatToolApproval);
const consumeChatToolApprovalSessionMock = vi.mocked(
  chatToolApprovalDb.consumeChatToolApprovalSession
);

beforeEach(() => {
  vi.clearAllMocks();
  createToolLoopRunnerMock.mockReturnValue({
    stream: vi.fn().mockResolvedValue({ awaitingApproval: false }),
  });
});

describe('createChatApproval', () => {
  it('persists approval batches with structured recovery context', () => {
    const approvals = createChatApproval({
      activeStreams: new Map(),
      memory: {
        injectMemoryIntoMessages: vi.fn(messages => messages),
      } as never,
      usage: {
        recordUsageEvent: vi.fn(),
      },
    });

    const runner = {} as never;
    const webContents = { id: 1, send: vi.fn() };

    approvals.registerApprovalBatch(
      [
        {
          approvalId: 'approval_1',
          toolCallId: 'call_1',
          toolCall: {
            toolName: 'web',
            args: { q: 'hello' },
          },
        },
      ],
      {
        runner,
        webContents,
        recoveryContext: {
          sessionId: 'assistant_1',
          threadId: 'thread_1',
          assistantMessageId: 'assistant_1',
          providerType: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'system prompt',
          maxOutputTokens: 640,
          maxIterations: 12,
          enabledTools: ['web'],
          availableSkillIds: [],
        },
      }
    );

    expect(upsertChatToolApprovalSessionMock).toHaveBeenCalledWith({
      session_id: 'assistant_1',
      thread_id: 'thread_1',
      assistant_message_id: 'assistant_1',
      provider_type: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'system prompt',
      max_output_tokens: 640,
      max_iterations: 12,
      enabled_tools: '["web"]',
      available_skill_ids: '[]',
    });
    expect(upsertChatToolApprovalsMock).toHaveBeenCalledWith([
      {
        approval_id: 'approval_1',
        session_id: 'assistant_1',
        tool_call_id: 'call_1',
        tool_name: 'web',
        tool_args: '{"q":"hello"}',
        state: 'pending',
      },
    ]);
  });

  it('recovers approval sessions from structured approval rows and resumes the tool loop', async () => {
    const resumedStream = vi.fn().mockResolvedValue({ awaitingApproval: false });
    createToolLoopRunnerMock.mockReturnValue({
      stream: resumedStream,
    });

    const runner = {
      registerTool: vi.fn(),
    };
    createChatConversationRunnerMock.mockReturnValue(runner as never);
    defaultToolRegistryGetMock.mockReturnValue({
      name: 'web',
      description: 'Search',
      parameters: {},
      handler: vi.fn(),
    } as never);

    getChatToolApprovalMock.mockReturnValue({
      approval_id: 'approval_1',
      session_id: 'assistant_1',
      tool_call_id: 'call_1',
      tool_name: 'web',
      tool_args: '{"q":"hello"}',
      state: 'pending',
      decision: null,
      decision_reason: null,
      responded_at: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    getChatToolApprovalSessionMock.mockReturnValue({
      session_id: 'assistant_1',
      thread_id: 'thread_1',
      assistant_message_id: 'assistant_1',
      provider_type: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'system prompt',
      max_output_tokens: 640,
      max_iterations: 12,
      enabled_tools: '["web"]',
      available_skill_ids: '[]',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    getActiveChatToolApprovalsBySessionMock.mockReturnValue([
      {
        approval_id: 'approval_1',
        session_id: 'assistant_1',
        tool_call_id: 'call_1',
        tool_name: 'web',
        tool_args: '{"q":"hello"}',
        state: 'pending',
        decision: null,
        decision_reason: null,
        responded_at: null,
        created_at: '2026-03-19T00:00:00.000Z',
        updated_at: '2026-03-19T00:00:00.000Z',
      },
    ]);
    getChatMessagesMock.mockReturnValue([
      {
        id: 'msg_1',
        thread_id: 'thread_1',
        parent_id: null,
        slot_id: null,
        depth: 0,
        message: JSON.stringify({
          id: 'msg_1',
          role: 'user',
          parts: [{ type: 'text', text: 'hello' }],
        }),
        timestamp: '2026-03-19T00:00:00.000Z',
        metadata: '{}',
        created_at: '2026-03-19T00:00:00.000Z',
        updated_at: '2026-03-19T00:00:00.000Z',
      },
    ]);

    const approvals = createChatApproval({
      activeStreams: new Map(),
      memory: {
        injectMemoryIntoMessages: vi.fn(messages => messages),
      } as never,
      usage: {
        recordUsageEvent: vi.fn(),
      },
    });

    const result = await approvals.approveTool({ id: 9, send: vi.fn() }, 'approval_1', true);

    expect(createChatConversationRunnerMock).toHaveBeenCalledWith({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      enableTools: true,
      maxIterations: 12,
      maxTokens: 640,
    });
    expect(runner.registerTool).toHaveBeenCalledTimes(1);
    expect(answerChatToolApprovalMock).toHaveBeenCalledWith(
      'approval_1',
      'approved',
      'User approved tool execution.'
    );
    expect(consumeChatToolApprovalSessionMock).toHaveBeenCalledWith('assistant_1');
    expect(resumedStream).toHaveBeenCalledWith(
      expect.objectContaining({
        runner,
        prompt: '',
        history: [
          expect.objectContaining({
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          }),
        ],
        approvalResponses: [
          expect.objectContaining({
            approvalId: 'approval_1',
            approved: true,
          }),
        ],
        approvalContext: expect.objectContaining({
          sessionId: 'assistant_resume',
          assistantMessageId: 'assistant_resume',
          threadId: 'thread_1',
          providerType: 'openai',
          model: 'gpt-4o-mini',
          maxOutputTokens: 640,
          maxIterations: 12,
          enabledTools: ['web'],
          availableSkillIds: [],
        }),
      })
    );
    expect(result).toEqual({
      success: true,
      awaitingApproval: false,
      stopped: false,
    });
  });

  it('re-registers load_skill when a recovered approval session carries selected skills', async () => {
    const resumedStream = vi.fn().mockResolvedValue({ awaitingApproval: false });
    createToolLoopRunnerMock.mockReturnValue({
      stream: resumedStream,
    });

    const runner = {
      registerTool: vi.fn(),
    };
    createChatConversationRunnerMock.mockReturnValue(runner as never);
    defaultToolRegistryGetMock.mockReturnValue({
      name: 'web',
      description: 'Search',
      parameters: {},
      handler: vi.fn(),
    } as never);

    getChatToolApprovalMock.mockReturnValue({
      approval_id: 'approval_2',
      session_id: 'assistant_skill_1',
      tool_call_id: 'call_2',
      tool_name: 'web',
      tool_args: '{"q":"hello"}',
      state: 'pending',
      decision: null,
      decision_reason: null,
      responded_at: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    getChatToolApprovalSessionMock.mockReturnValue({
      session_id: 'assistant_skill_1',
      thread_id: 'thread_skill_1',
      assistant_message_id: 'assistant_skill_1',
      provider_type: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'system prompt',
      max_iterations: null,
      enabled_tools: '["web"]',
      available_skill_ids: '["user:planner"]',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    getActiveChatToolApprovalsBySessionMock.mockReturnValue([
      {
        approval_id: 'approval_2',
        session_id: 'assistant_skill_1',
        tool_call_id: 'call_2',
        tool_name: 'web',
        tool_args: '{"q":"hello"}',
        state: 'pending',
        decision: null,
        decision_reason: null,
        responded_at: null,
        created_at: '2026-03-19T00:00:00.000Z',
        updated_at: '2026-03-19T00:00:00.000Z',
      },
    ]);
    getChatMessagesMock.mockReturnValue([
      {
        id: 'msg_skill_1',
        thread_id: 'thread_skill_1',
        parent_id: null,
        slot_id: null,
        depth: 0,
        message: JSON.stringify({
          id: 'msg_skill_1',
          role: 'user',
          parts: [{ type: 'text', text: 'hello' }],
        }),
        timestamp: '2026-03-19T00:00:00.000Z',
        metadata: '{}',
        created_at: '2026-03-19T00:00:00.000Z',
        updated_at: '2026-03-19T00:00:00.000Z',
      },
    ]);

    const approvals = createChatApproval({
      activeStreams: new Map(),
      memory: {
        injectMemoryIntoMessages: vi.fn(messages => messages),
      } as never,
      usage: {
        recordUsageEvent: vi.fn(),
      },
    });

    await approvals.approveTool({ id: 11, send: vi.fn() }, 'approval_2', true);

    expect(runner.registerTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'load_skill',
      })
    );
    expect(runner.registerTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: 'web',
      })
    );
    expect(resumedStream).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalContext: expect.objectContaining({
          availableSkillIds: ['user:planner'],
        }),
      })
    );
  });
});
