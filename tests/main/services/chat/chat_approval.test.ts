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

vi.mock('../../../../src/core/db/agent_runs', () => ({
  getAgentRun: vi.fn(),
  getLatestAgentRunCheckpoint: vi.fn(),
}));

vi.mock('../../../../src/core/tools', () => ({
  defaultToolRegistry: {
    get: vi.fn(),
  },
}));

vi.mock('../../../../src/core/provider/llm/factory', () => ({
  resolveModelCapability: vi.fn(async () => null),
}));

vi.mock('../../../../src/main/services/chat/chat_ui', () => ({
  createUiChunkEmitter: vi.fn(() => ({
    messageId: 'assistant_resume',
    emitTextDelta: vi.fn(),
    emitToolEvent: vi.fn(),
    emitMemoryRetrieval: vi.fn(),
    emitAffectSignal: vi.fn(),
    emitTokenUsage: vi.fn(),
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

vi.mock('../../../../src/main/services/chat/chat_run_tracking', () => ({
  createAgentRunTracker: vi.fn(),
}));

import * as agentRunDb from '../../../../src/core/db/agent_runs';
import * as chatToolApprovalDb from '../../../../src/core/db/chat_tool_approval';
import * as chatMessageDb from '../../../../src/core/db/chat_message';
import { defaultToolRegistry } from '../../../../src/core/tools';
import { createChatApproval } from '../../../../src/main/services/chat/chat_approval';
import { createChatConversationRunner } from '../../../../src/main/services/chat/chat_conversation_runner';
import { createAgentRunTracker } from '../../../../src/main/services/chat/chat_run_tracking';
import { createToolLoopRunner } from '../../../../src/main/services/chat/chat_tool_loop';

const createToolLoopRunnerMock = vi.mocked(createToolLoopRunner);
const createChatConversationRunnerMock = vi.mocked(createChatConversationRunner);
const createAgentRunTrackerMock = vi.mocked(createAgentRunTracker);
const getAgentRunMock = vi.mocked(agentRunDb.getAgentRun);
const getLatestAgentRunCheckpointMock = vi.mocked(agentRunDb.getLatestAgentRunCheckpoint);
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
  getAgentRunMock.mockReturnValue(null);
  getLatestAgentRunCheckpointMock.mockReturnValue(null);
  createAgentRunTrackerMock.mockImplementation(() => {
    let status = 'running';
    return {
      id: 'run_resume_1',
      getRun: () => ({ status }),
      syncModelMessages: vi.fn(() => ({ status })),
      recordToolEvent: vi.fn(),
      markCompleted: vi.fn(() => {
        status = 'completed';
        return { status };
      }),
      markBlocked: vi.fn(() => {
        status = 'blocked';
        return { status };
      }),
      markFailed: vi.fn(() => {
        status = 'failed';
        return { status };
      }),
      markCancelled: vi.fn(() => {
        status = 'cancelled';
        return { status };
      }),
    };
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

    const harness = {} as never;
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
        harness,
        webContents,
        recoveryContext: {
          sessionId: 'assistant_1',
          threadId: 'thread_1',
          assistantMessageId: 'assistant_1',
          runId: 'run_1',
          providerType: 'openai',
          providerId: 'primary-openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'system prompt',
          maxInputTokens: 128000,
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
      run_id: 'run_1',
      provider_type: 'openai',
      provider_id: 'primary-openai',
      model: 'gpt-4o-mini',
      system_prompt: 'system prompt',
      max_input_tokens: 128000,
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

  it('recovers approval sessions from runtime checkpoints and resumes the tool loop', async () => {
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
      run_id: 'run_blocked_1',
      provider_type: 'openai',
      provider_id: 'primary-openai',
      model: 'gpt-4o-mini',
      system_prompt: 'system prompt',
      max_input_tokens: 128000,
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
    getLatestAgentRunCheckpointMock.mockReturnValue({
      id: 'checkpoint_1',
      runId: 'run_blocked_1',
      stepIndex: 2,
      reason: 'approval-requested',
      snapshot: {
        id: 'run_blocked_1',
        kind: 'chat-turn',
        status: 'blocked',
        threadId: 'thread_1',
        parentRunId: null,
        rootRunId: 'run_blocked_1',
        providerType: 'openai',
        providerId: 'primary-openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'system prompt',
        enabledTools: ['web'],
        availableSkillIds: [],
        input: {
          metadata: {
            maxIterations: 12,
          },
        },
        working: {
          modelMessages: [{ role: 'user', content: 'hello' }],
          accumulatedText: 'partial',
          pendingApprovalIds: ['approval_1'],
          lastStepIndex: 2,
        },
        output: {
          text: 'partial',
          finishReason: 'approval-requested',
        },
        error: null,
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z',
      },
      createdAt: '2026-03-19T00:00:00.000Z',
    });
    const injectMemoryIntoMessagesMock = vi.fn(messages => messages);

    const approvals = createChatApproval({
      activeStreams: new Map(),
      memory: {
        injectMemoryIntoMessages: injectMemoryIntoMessagesMock,
      } as never,
      usage: {
        recordUsageEvent: vi.fn(),
      },
    });

    const result = await approvals.approveTool({ id: 9, send: vi.fn() }, 'approval_1', true);

    expect(createChatConversationRunnerMock).toHaveBeenCalledWith({
      providerType: 'openai',
      providerId: 'primary-openai',
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
    expect(getChatMessagesMock).not.toHaveBeenCalled();
    expect(injectMemoryIntoMessagesMock).not.toHaveBeenCalled();
    expect(consumeChatToolApprovalSessionMock).toHaveBeenCalledWith('assistant_1');
    expect(createAgentRunTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'approval-resume',
        threadId: 'thread_1',
        parentRunId: 'run_blocked_1',
      })
    );
    expect(resumedStream).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: expect.objectContaining({
          getRegisteredTools: expect.any(Function),
          getHistory: expect.any(Function),
          stream: expect.any(Function),
        }),
        prompt: '',
        history: [
          expect.objectContaining({
            role: 'user',
            content: 'hello',
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
          runId: 'run_resume_1',
          providerType: 'openai',
          providerId: 'primary-openai',
          model: 'gpt-4o-mini',
          maxInputTokens: 128000,
          maxOutputTokens: 640,
          maxIterations: 12,
          enabledTools: ['web'],
          availableSkillIds: [],
        }),
      })
    );
    expect(createAgentRunTrackerMock.mock.results[0]?.value.syncModelMessages).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hello' }]
    );
    expect(createAgentRunTrackerMock.mock.results[0]?.value.markCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        finishReason: 'completed',
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
      run_id: null,
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

    expect(getChatMessagesMock).toHaveBeenCalledWith('thread_skill_1');
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
          runId: 'run_resume_1',
          availableSkillIds: ['user:planner'],
        }),
      })
    );
  });
});
