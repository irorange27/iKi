import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';

/** Minimal plan fixture matching what the stream/send entries assemble. */
const makePlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  providerType: 'openai',
  model: 'test',
  enableTools: true,
  enabledTools: [],
  availableSkillIds: [],
  guardActive: false,
  requireApproval: true,
  autoApproveToolRequests: false,
  maxIterations: 20,
  systemPrompt: 'system',
  skillMode: 'manual',
  kind: 'chat-turn',
  runMetadata: {},
  transport: 'stream',
  ...overrides,
});

vi.mock('@iki/backend/db/tool_call_approval', () => ({
  upsertToolCallApprovalSession: vi.fn(),
  upsertToolCallApprovals: vi.fn(),
  getToolCallApproval: vi.fn(),
  getToolCallApprovalSession: vi.fn(),
  getActiveToolCallApprovalsBySession: vi.fn(),
  answerToolCallApproval: vi.fn(),
  consumeToolCallApprovalSession: vi.fn(),
  expirePendingToolCallApprovalsByRunIds: vi.fn(() => []),
}));

vi.mock('@iki/backend/db/chat_message', () => ({
  getChatMessages: vi.fn(),
}));

// F2: recovery history comes from the session log. The real module would
// auto-initialize the developer's default database (getDb falls back to
// initializeDatabase()), so the replay is mocked per test instead.
vi.mock('@iki/backend/db/session_events', () => ({
  getSessionEvents: vi.fn(() => []),
  appendSessionFacts: vi.fn(),
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  getAgentRun: vi.fn(),
}));

vi.mock('@iki/backend/tools', () => ({
  defaultToolRegistry: {
    get: vi.fn(),
  },
}));

vi.mock('@iki/backend/provider/llm/factory', () => ({
  resolveModelCapability: vi.fn(async () => null),
  // Supply selection (switch item 3b): approval-resume tests exercise the
  // AI SDK harness — the Pi supply never admits these plans.
  supportsPiTurnSupply: vi.fn(() => false),
}));

vi.mock('@iki/backend/message/ui_messages', () => ({
  createUiChunkEmitter: vi.fn(() => ({
    messageId: 'assistant_resume',
    emitTextDelta: vi.fn(),
    emitReasoningDelta: vi.fn(),
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
  rehydrateHarness: vi.fn(),
  cloneModelMessages: (messages: unknown[]) => structuredClone(messages),
}));

vi.mock('@iki/backend/thread_session/run_tracker', () => ({
  createAgentRunTracker: vi.fn(),
  rehydrateAgentRunTracker: vi.fn(() => null),
}));

import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import * as sessionEventsDb from '@iki/backend/db/session_events';
import { defaultToolRegistry } from '@iki/backend/tools';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { rehydrateHarness } from '@iki/backend/agent/harness';

const rehydrateHarnessMock = vi.mocked(rehydrateHarness);
const createAgentRunTrackerMock = vi.mocked(createAgentRunTracker);
const getAgentRunMock = vi.mocked(agentRunDb.getAgentRun);
const getSessionEventsMock = vi.mocked(sessionEventsDb.getSessionEvents);
const defaultToolRegistryGetMock = vi.mocked(defaultToolRegistry.get);
const upsertToolCallApprovalSessionMock = vi.mocked(
  toolCallApprovalDb.upsertToolCallApprovalSession
);
const upsertToolCallApprovalsMock = vi.mocked(toolCallApprovalDb.upsertToolCallApprovals);
const getToolCallApprovalMock = vi.mocked(toolCallApprovalDb.getToolCallApproval);
const getToolCallApprovalSessionMock = vi.mocked(toolCallApprovalDb.getToolCallApprovalSession);
const getActiveToolCallApprovalsBySessionMock = vi.mocked(
  toolCallApprovalDb.getActiveToolCallApprovalsBySession
);
const answerToolCallApprovalMock = vi.mocked(toolCallApprovalDb.answerToolCallApproval);
const consumeToolCallApprovalSessionMock = vi.mocked(
  toolCallApprovalDb.consumeToolCallApprovalSession
);
const expirePendingToolCallApprovalsByRunIdsMock = vi.mocked(
  toolCallApprovalDb.expirePendingToolCallApprovalsByRunIds
);

beforeEach(() => {
  vi.clearAllMocks();
  rehydrateHarnessMock.mockImplementation(function () {
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
      getHistory: vi.fn(() => capturedHistory),
    };
  });
  getAgentRunMock.mockReturnValue(null);
  createAgentRunTrackerMock.mockImplementation(() => {
    let status = 'running';
    return {
      id: 'run_resume_1',
      getRun: () => ({ status }),
      syncModelMessages: vi.fn(() => ({ status })),
      recordAgentStep: vi.fn(),
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
  it('expires run-scoped approvals and timers when a blocked run is cancelled', () => {
    vi.useFakeTimers();
    expirePendingToolCallApprovalsByRunIdsMock.mockReturnValue(['isolated'] as never);
    const coordinator = createThreadStreamCoordinator();
    const approvals = createChatApproval({
      streams: {
        tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
        peek: coordinator.peekStream,
        attach: coordinator.attachStream,
        detach: coordinator.detachStream,
      },
      memory: {} as never,
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      usage: { recordUsageEvent: vi.fn() },
    });
    approvals.registerApprovalBatch(
      [{ approvalId: 'isolated', toolCallId: 'call', toolCall: { toolName: 'shell', args: {} } }],
      {
        target: { id: 99, send: vi.fn() },
        history: [{ role: 'user', content: 'task' }],
        recoveryContext: {
          plan: makePlan({ enabledTools: ['shell'], threadId: 'thread_a' }),
          sessionId: 'session_a',
          assistantMessageId: 'session_a',
          runId: 'run_1',
        },
      }
    );

    try {
      expect(vi.getTimerCount()).toBe(1);
      expect(approvals.cancelPendingApprovalsForRun('run_1')).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(expirePendingToolCallApprovalsByRunIdsMock).toHaveBeenCalledWith(['run_1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps approval decisions pending while a turn owns the thread and resumes once', async () => {
    const coordinator = createThreadStreamCoordinator();
    const approvals = createChatApproval({
      streams: { tryAcquireThreadRun: coordinator.tryAcquireThreadRun, peek: coordinator.peekStream, attach: coordinator.attachStream, detach: coordinator.detachStream },
      memory: {} as never, conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() }, usage: { recordUsageEvent: vi.fn() },
    });
    const target = { id: 99, send: vi.fn() };
    approvals.registerApprovalBatch([{ approvalId: 'isolated', toolCallId: 'call', toolCall: { toolName: 'shell', args: {} } }], {
      target, history: [{ role: 'user', content: 'task' }],
      recoveryContext: { plan: makePlan({ enabledTools: ['shell'], threadId: 'thread_a' }), sessionId: 'session_a', assistantMessageId: 'session_a' },
    });
    const release = coordinator.tryAcquireThreadRun('thread_a')!;
    expect(await approvals.approveTool(target, 'isolated', true)).toMatchObject({ success: false });
    expect(answerToolCallApprovalMock).not.toHaveBeenCalled();
    release();
    const results = await Promise.all([approvals.approveTool(target, 'isolated', true), approvals.approveTool(target, 'isolated', true)]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(answerToolCallApprovalMock).toHaveBeenCalledTimes(1);
    expect(rehydrateHarnessMock).toHaveBeenCalledTimes(1);
    approvals.cleanupPendingSessionsForSender(99);
  });

  it('cleans up only the specified approval session on a shared sender', () => {
    vi.useFakeTimers();
    const approvals = createChatApproval({
      streams: { tryAcquireThreadRun: createThreadStreamCoordinator().tryAcquireThreadRun, peek: vi.fn(), attach: vi.fn(), detach: vi.fn() },
      memory: {} as never, conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() }, usage: { recordUsageEvent: vi.fn() },
    });
    try {
      for (const id of ['a', 'b']) approvals.ensurePendingApprovalSession(id, {
        target: { id: 7, send: vi.fn() }, recoveryContext: { plan: makePlan({ systemPrompt: '', threadId: id }), sessionId: id, assistantMessageId: id },
      });
      approvals.cleanupPendingSessionsForSender(7, 'a');
      expect(vi.getTimerCount()).toBe(1);
      approvals.cleanupPendingSessionsForSender(7, 'b');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      approvals.cleanupPendingSessionsForSender(7);
      vi.useRealTimers();
    }
  });

  it.each([1, 2])('persists timeout decisions and resumes one batch of %s approvals once', async count => {
    vi.useFakeTimers();
    const approvals = createChatApproval({
      streams: { tryAcquireThreadRun: createThreadStreamCoordinator().tryAcquireThreadRun, peek: vi.fn(), attach: vi.fn(), detach: vi.fn() },
      memory: {} as never, conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() }, usage: { recordUsageEvent: vi.fn() },
    });
    const requests = Array.from({ length: count }, (_, index) => ({
      approvalId: `timeout_${index}`, toolCallId: `call_${index}`,
      toolCall: { toolName: 'shell', args: { command: 'work' } },
    }));
    try {
      approvals.registerApprovalBatch(requests, {
        target: { id: 99, send: vi.fn() },
        history: [{ role: 'user', content: 'task' }],
        recoveryContext: {
          plan: makePlan({ enabledTools: ['shell'], threadId: 'thread_timeout' }),
          sessionId: 'timeout_session', assistantMessageId: 'timeout_session',
        },
      });
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      for (const request of requests) expect(answerToolCallApprovalMock).toHaveBeenCalledWith(
        request.approvalId, 'rejected', 'Approval timed out after 30 minutes',
      );
      expect(consumeToolCallApprovalSessionMock).toHaveBeenCalledWith('timeout_session');
      expect(rehydrateHarnessMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      approvals.cleanupPendingSessionsForSender(99);
      vi.useRealTimers();
    }
  });

  it('persists approval batches with structured recovery context', () => {
    const approvals = createChatApproval({
      streams: { tryAcquireThreadRun: createThreadStreamCoordinator().tryAcquireThreadRun,
        peek: vi.fn(() => undefined),
        attach: vi.fn(),
        detach: vi.fn(),
      },
      memory: {
        injectMemoryIntoMessages: vi.fn(messages => messages),
      } as never,
      usage: {
        recordUsageEvent: vi.fn(),
      },
    });

    const harness = {} as never;
    const target = { id: 1, send: vi.fn() };

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
        target,
        recoveryContext: {
          plan: makePlan({
            providerId: 'primary-openai',
            model: 'gpt-4o-mini',
            systemPrompt: 'system prompt',
            maxInputTokens: 128000,
            maxOutputTokens: 640,
            maxIterations: 12,
            enabledTools: ['web'],
            threadId: 'thread_1',
          }),
          sessionId: 'assistant_1',
          assistantMessageId: 'assistant_1',
          runId: 'run_1',
        },
      }
    );

    expect(upsertToolCallApprovalSessionMock).toHaveBeenCalledWith({
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
      // Turn-start workspace binding rides with the session row (D30); this
      // fixture records none, so the column stays null.
      workspace_selection: null,
      // The full ExecutionPlan snapshot rides with the row so a
      // restart-recovered resume restores every field exactly.
      plan_json: expect.any(String),
    });
    expect(upsertToolCallApprovalsMock).toHaveBeenCalledWith([
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

  it('re-registers load_skill when a recovered approval session carries selected skills', async () => {
    defaultToolRegistryGetMock.mockReturnValue({
      name: 'web',
      description: 'Search',
      parameters: {},
      handler: vi.fn(),
    } as never);

    getToolCallApprovalMock.mockReturnValue({
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
    getToolCallApprovalSessionMock.mockReturnValue({
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
    getActiveToolCallApprovalsBySessionMock.mockReturnValue([
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
    // F2: the recovery history source is the session log replay — the
    // recorded facts stand in for what a real pause persists.
    getSessionEventsMock.mockReturnValueOnce([
      {
        revision: 1,
        type: 'input_accepted',
        version: 1,
        payload: {
          messageId: 'msg_skill_1',
          message: {
            id: 'msg_skill_1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          },
        },
      },
      {
        revision: 2,
        type: 'approval_requested',
        version: 1,
        payload: {
          approvalId: 'approval_2',
          sessionId: 'assistant_skill_1',
          toolCallId: 'call_2',
          toolName: 'web',
          args: { q: 'hello' },
        },
      },
    ] as never);

    const approvals = createChatApproval({
      streams: { tryAcquireThreadRun: createThreadStreamCoordinator().tryAcquireThreadRun,
        peek: vi.fn(() => undefined),
        attach: vi.fn(),
        detach: vi.fn(),
      },
      memory: {
        injectMemoryIntoMessages: vi.fn(messages => messages),
      } as never,
      usage: {
        recordUsageEvent: vi.fn(),
      },
    });

    const recovered = await Promise.all([
      approvals.approveTool({ id: 11, send: vi.fn() }, 'approval_2', true),
      approvals.approveTool({ id: 12, send: vi.fn() }, 'approval_2', true),
    ]);
    expect(recovered.filter(result => result.success)).toHaveLength(1);
    expect(rehydrateHarnessMock).toHaveBeenCalledTimes(1);

    expect(getSessionEventsMock).toHaveBeenCalledWith('thread_skill_1');
    expect(rehydrateHarnessMock).toHaveBeenCalledWith(
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

  it('cleans up pending approval sessions for a given target senderId', async () => {
    const approvals = createChatApproval({
      streams: { tryAcquireThreadRun: createThreadStreamCoordinator().tryAcquireThreadRun,
        peek: vi.fn(() => undefined),
        attach: vi.fn(),
        detach: vi.fn(),
      },
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

    // Register approval sessions for two different target
    approvals.ensurePendingApprovalSession('approval_a1', {
      harness,
      target: webContents1,
    });
    approvals.ensurePendingApprovalSession('approval_a2', {
      harness,
      target: webContents1,
    });
    approvals.ensurePendingApprovalSession('approval_b1', {
      harness,
      target: webContents2,
    });

    // DB has no records for these approvals
    getToolCallApprovalMock.mockReturnValue(null);

    // Clean up sessions for senderId=1
    approvals.cleanupPendingSessionsForSender(1);

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
