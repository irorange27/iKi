import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/db/chat_tool_approval', () => ({
  upsertChatToolApprovalSession: vi.fn(),
  upsertChatToolApprovals: vi.fn(),
  getChatToolApproval: vi.fn(),
  getChatToolApprovalSession: vi.fn(),
  getActiveChatToolApprovalsBySession: vi.fn(),
  answerChatToolApproval: vi.fn(),
  consumeChatToolApprovalSession: vi.fn(),
}));

vi.mock('@iki/backend/db/chat_message', () => ({
  getChatMessages: vi.fn(),
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  getAgentRun: vi.fn(),
  getLatestAgentRunCheckpoint: vi.fn(),
}));

vi.mock('@iki/core/tools', () => ({
  defaultToolRegistry: {
    get: vi.fn(),
  },
}));

vi.mock('@iki/backend/provider/llm/factory', () => ({
  resolveModelCapability: vi.fn(async () => null),
}));

vi.mock('@iki/backend/chat_service/ui_messages', () => ({
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

vi.mock('@iki/backend/agent/harness', () => ({
  AgentHarness: vi.fn(),
}));

vi.mock('@iki/backend/agent/run_tracker', () => ({
  createAgentRunTracker: vi.fn(),
}));

import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as chatToolApprovalDb from '@iki/backend/db/chat_tool_approval';
import * as chatMessageDb from '@iki/backend/db/chat_message';
import { defaultToolRegistry } from '@iki/core/tools';
import { createChatApproval } from '@iki/backend/chat_service/approval';
import { createAgentRunTracker } from '@iki/backend/agent/run_tracker';
import { AgentHarness } from '@iki/backend/agent/harness';

const AgentHarnessMock = vi.mocked(AgentHarness);
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
  AgentHarnessMock.mockImplementation(function () {
    let capturedHistory: ModelMessage[] = [];
    return {
      turn: vi.fn().mockImplementation(async function* (
        input: { history?: ModelMessage[] }
      ) {
        capturedHistory = input.history ?? [];
        yield {
          event: 'done' as const,
          output: { text: '', usage: undefined, requiresApproval: false },
        };
      }),
      cancel: vi.fn(),
      steer: vi.fn(),
      getHistory: vi.fn(() => capturedHistory),
    };
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

    // Session history with approval response fed to the runner

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
    expect(AgentHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        providerId: 'primary-openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'system prompt',
        enableTools: true,
        enabledToolNames: ['web'],
        availableSkillIds: [],
        maxIterations: 12,
        maxOutputTokens: 640,
      })
    );
    // Session history with approval response fed to the runner
    expect(createAgentRunTrackerMock.mock.results[0]?.value.syncModelMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'hello',
        }),
      ])
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
    expect(AgentHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'system prompt',
        enableTools: true,
        enabledToolNames: ['web'],
        availableSkillIds: ['user:planner'],
      })
    );
  });

  it('cleans up pending approval sessions for a given webContents senderId', async () => {
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
    const webContents1 = { id: 1, send: vi.fn() };
    const webContents2 = { id: 2, send: vi.fn() };

    // Register approval sessions for two different webContents
    approvals.ensurePendingApprovalSession('approval_a1', {
      harness,
      webContents: webContents1,
    });
    approvals.ensurePendingApprovalSession('approval_a2', {
      harness,
      webContents: webContents1,
    });
    approvals.ensurePendingApprovalSession('approval_b1', {
      harness,
      webContents: webContents2,
    });

    // DB has no records for these approvals
    getChatToolApprovalMock.mockReturnValue(null);

    // Clean up sessions for senderId=1
    approvals.cleanupPendingSessionsForWebContents(1);

    // Approvals for senderId=1 should be gone
    const result1 = await approvals.approveTool(webContents1, 'approval_a1', true);
    expect(result1.success).toBe(false);
    expect(result1.error).toBe('Approval request not found or already processed.');

    const result2 = await approvals.approveTool(webContents1, 'approval_a2', true);
    expect(result2.success).toBe(false);
    expect(result2.error).toBe('Approval request not found or already processed.');

    // Approval for senderId=2 should still be accessible (not cleaned up)
    const result3 = await approvals.approveTool(webContents2, 'approval_b1', true);
    expect(result3.error).not.toBe('Approval request not found or already processed.');
  });
});
