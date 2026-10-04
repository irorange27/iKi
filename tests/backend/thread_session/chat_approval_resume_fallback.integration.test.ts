import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
  };
});

vi.mock('@iki/backend/db/tool_call_approval', () => ({
  getToolCallApproval: vi.fn(),
  getToolCallApprovalSession: vi.fn(),
  getActiveToolCallApprovalsBySession: vi.fn(),
  answerToolCallApproval: vi.fn(),
  consumeToolCallApprovalSession: vi.fn(),
  upsertToolCallApprovals: vi.fn(),
  upsertToolCallApprovalSession: vi.fn(),
}));

vi.mock('@iki/backend/db/chat_message', () => ({
  getChatMessages: vi.fn(),
  getChatMessage: vi.fn(() => ({
    id: 'assistant_fb_1',
    message: JSON.stringify({
      role: 'assistant',
      parts: [{ type: 'text', text: 'before pause', state: 'done' }],
    }),
  })),
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  appendAgentRunStep: vi.fn(),
  appendAgentRunStepAndUpdateRun: vi.fn((
    step: { runId: string; stepIndex: number },
    updates: Record<string, unknown>
  ) => ({
    id: step.runId,
    kind: 'approval-resume',
    status: updates.status ?? 'running',
    threadId: 'thread_1',
    parentRunId: 'run_blocked_1',
    rootRunId: 'run_blocked_1',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    working: {
      modelMessages: [],
      accumulatedText: '',
      pendingApprovalIds: [],
      lastStepIndex: step.stepIndex,
      ...((updates.working as Record<string, unknown> | undefined) ?? {}),
    },
    output: updates.output ?? null,
    error: updates.error ?? null,
  })),
  createAgentRun: vi.fn((run: Record<string, unknown>) => ({
    ...run,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  })),
  createAgentRunCheckpoint: vi.fn(),
  getAgentRun: vi.fn(() => null),
  listAgentRunSteps: vi.fn(() => []),
  updateAgentRun: vi.fn((id: string, updates: Record<string, unknown>) => ({
    id,
    kind: 'approval-resume',
    status: 'running',
    threadId: 'thread_1',
    ...updates,
  })),
}));

import * as approvalDb from '@iki/backend/db/tool_call_approval';
import * as chatMessageDb from '@iki/backend/db/chat_message';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const toolName = 'approval_fallback_probe';

// Legacy recovery: the run snapshot is gone (pre-run-tracking threads, lost run
// rows) and the only history is the persisted UI transcript. At approval-wait
// the renderer stores the assistant message with the tool part still in
// `approval-requested`. The fallback rebuild must preserve that pending call so
// the user's decision still executes the tool.
describe('createChatApproval resume from UI history fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    defaultToolRegistry.remove(toolName);
  });

  it.each([
    { approved: true },
    { approved: false },
  ])('executes the approved call from persisted UI history when the run snapshot is missing ($approved)', async ({ approved }) => {
    let executions = 0;
    const tool = createTool({
      name: toolName,
      type: 'function',
      description: 'Probe fallback approval resume',
      paramSchema: z.object({}),
      needsApproval: false,
      handler: async () => {
        executions++;
        return { executed: true };
      },
    });
    defaultToolRegistry.register(tool);

    const approvalId = 'approval_fb_1';
    const approvalRecord = {
      approval_id: approvalId,
      session_id: 'assistant_fb_1',
      tool_call_id: 'call_fb_1',
      tool_name: toolName,
      tool_args: '{}',
      state: 'pending',
      decision: null,
      decision_reason: null,
      responded_at: null,
      created_at: '2026-06-20T00:00:00.000Z',
      updated_at: '2026-06-20T00:00:00.000Z',
    };

    // What the renderer persists 300ms after the approval chunk arrives.
    const persistedAssistantMessage = {
      id: 'assistant_fb_1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'I will run the probe.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolCallId: 'call_fb_1',
          toolName,
          state: 'approval-requested',
          input: {},
          approval: { id: approvalId },
        },
      ],
    };

    vi.mocked(approvalDb.getToolCallApproval).mockReturnValue(approvalRecord as never);
    vi.mocked(approvalDb.getToolCallApprovalSession).mockReturnValue({
      session_id: 'assistant_fb_1',
      thread_id: 'thread_1',
      assistant_message_id: 'assistant_fb_1',
      run_id: 'run_missing',
      provider_type: 'openai',
      provider_id: 'provider_primary',
      model: 'gpt-4o-mini',
      system_prompt: 'system prompt',
      max_input_tokens: null,
      max_output_tokens: null,
      max_iterations: 10,
      enabled_tools: JSON.stringify([toolName]),
      available_skill_ids: '[]',
      created_at: '2026-06-20T00:00:00.000Z',
      updated_at: '2026-06-20T00:00:00.000Z',
    } as never);
    vi.mocked(approvalDb.getActiveToolCallApprovalsBySession).mockReturnValue([approvalRecord] as never);
    vi.mocked(chatMessageDb.getChatMessages).mockReturnValue([
      {
        id: 'user_fb_1',
        thread_id: 'thread_1',
        parent_id: null,
        slot_id: null,
        depth: 0,
        message: JSON.stringify({
          id: 'user_fb_1',
          role: 'user',
          parts: [{ type: 'text', text: 'run the probe', state: 'done' }],
        }),
        timestamp: '2026-06-20T00:00:00.000Z',
        metadata: '{}',
      },
      {
        id: 'assistant_fb_1',
        thread_id: 'thread_1',
        parent_id: 'user_fb_1',
        slot_id: null,
        depth: 0,
        message: JSON.stringify(persistedAssistantMessage),
        timestamp: '2026-06-20T00:00:01.000Z',
        metadata: '{}',
      },
    ] as never);

    createModelMock.mockReturnValue(new FauxModelProvider([
      fauxText('resumed from ui history'),
    ], 'gpt-4o-mini'));

    const streamCoordinator = createThreadStreamCoordinator();
    const target = { id: 7, send: vi.fn() };
    const conversationMocks = {
      createMessage: vi.fn(),
      upsertTurnMessage: vi.fn(),
    };
    const approvals = createChatApproval({
      streams: {
        tryAcquireThreadRun: createThreadStreamCoordinator().tryAcquireThreadRun,
        peek: streamCoordinator.peekStream,
        attach: streamCoordinator.attachStream,
        detach: streamCoordinator.detachStream,
      },
      memory: { injectMemoryIntoMessages: vi.fn(messages => messages) } as never,
      conversation: conversationMocks,
      usage: { recordUsageEvent: vi.fn() },
    });

    const result = await approvals.approveTool(target, approvalId, approved);

    // The completion result exposes the continuation thread + reply so hosts
    // that own conversation persistence (daemon WS) can record it.
    expect(result).toMatchObject({
      success: true,
      awaitingApproval: false,
      stopped: false,
      threadId: 'thread_1',
      text: 'resumed from ui history',
    });
    // The approved decision must still execute the pending tool call; a
    // rejection must not execute it.
    expect(executions).toBe(approved ? 1 : 0);
    expect(approvalDb.consumeToolCallApprovalSession).toHaveBeenCalledWith('assistant_fb_1');
    // Retro-review regression: seeded continuation upsert under the resumed id.
    expect(conversationMocks.upsertTurnMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'assistant_fb_1',
      thread_id: 'thread_1',
      message: expect.objectContaining({
        role: 'assistant',
        parts: expect.arrayContaining([
          expect.objectContaining({ text: 'before pause' }),
          expect.objectContaining({ text: 'resumed from ui history' }),
        ]),
      }),
    }));

    const chunks = target.send.mock.calls
      .filter(call => call[0] === 'chat:ui-chunk')
      .map(call => call[1]);
    expect(chunks.map(chunk => chunk.type)).toEqual(expect.arrayContaining(['finish']));
  });
});
