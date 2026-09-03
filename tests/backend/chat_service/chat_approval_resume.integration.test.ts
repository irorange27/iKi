import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    getFullSystemPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
  };
});

vi.mock('@iki/backend/db/chat_tool_approval', () => ({
  getChatToolApproval: vi.fn(),
  getChatToolApprovalSession: vi.fn(),
  getActiveChatToolApprovalsBySession: vi.fn(),
  answerChatToolApproval: vi.fn(),
  consumeChatToolApprovalSession: vi.fn(),
  upsertChatToolApprovalSession: vi.fn(),
  upsertChatToolApprovals: vi.fn(),
}));

vi.mock('@iki/backend/db/chat_message', () => ({
  getChatMessages: vi.fn(),
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  appendAgentRunStep: vi.fn(),
  createAgentRun: vi.fn((run: Record<string, unknown>) => ({
    ...run,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  })),
  createAgentRunCheckpoint: vi.fn(),
  getAgentRun: vi.fn(() => null),
  updateAgentRun: vi.fn((id: string, updates: Record<string, unknown>) => ({
    id,
    kind: 'approval-resume',
    status: 'running',
    threadId: 'thread_1',
    parentRunId: 'run_blocked_1',
    rootRunId: 'run_blocked_1',
    providerType: 'openai',
    providerId: 'provider_primary',
    model: 'gpt-4o-mini',
    systemPrompt: 'system prompt',
    enabledTools: ['approval_resume_probe'],
    availableSkillIds: [],
    input: {},
    working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
    output: null,
    error: null,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...updates,
  })),
}));

import * as approvalDb from '@iki/backend/db/chat_tool_approval';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createChatApproval } from '@iki/backend/agent_session/approval';
import { AgentHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { getToolRuntimeContext, runWithToolRuntimeContext } from '@iki/backend/tools/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const toolName = 'approval_resume_probe';

const baseApprovalRecord = {
  approval_id: 'approval_1',
  session_id: 'assistant_1',
  tool_call_id: 'call_1',
  tool_name: toolName,
  tool_args: '{}',
  state: 'pending',
  decision: null,
  decision_reason: null,
  responded_at: null,
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
};

describe('createChatApproval resume integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    defaultToolRegistry.remove(toolName);
  });

  it('resumes approved tools through AgentHarness and preserves runtime context', async () => {
    let observedContext: unknown;
    const tool = createTool({
      name: toolName,
      type: 'function',
      description: 'Probe approval resume context',
      paramSchema: z.object({}),
      needsApproval: true,
      approvalMode: 'always',
      handler: async () => {
        const ctx = getToolRuntimeContext();
        observedContext = {
          threadId: ctx.threadId,
          runId: ctx.runId,
          hasRunTracker: !!ctx.runTracker,
          conversationModel: ctx.conversationModel,
        };
        return observedContext;
      },
    });
    defaultToolRegistry.register(tool);

    const blockedModel = new FauxModelProvider([
      fauxToolCall(toolName, {}, { id: 'call_1' }),
    ]);
    const blockedHarness = new AgentHarness({
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 10,
      modelFactory: () => blockedModel,
    });

    const blockedEvents = [];
    await runWithToolRuntimeContext(
      {
        threadId: 'thread_1',
        runId: 'run_blocked_1',
        conversationModel: {
          providerType: 'openai',
          providerId: 'provider_primary',
          model: 'gpt-4o-mini',
        },
      },
      async () => {
        for await (const event of blockedHarness.turn({ prompt: 'run approval probe' })) {
          blockedEvents.push(event);
        }
      }
    );

    const approvalRequest = blockedEvents.find(
      event => event.event === 'step' && event.step.type === 'approval_request'
    );
    expect(approvalRequest).toBeDefined();
    const approvedId = approvalRequest!.step.requests[0].approvalId;
    const approvedRecord = {
      ...baseApprovalRecord,
      approval_id: approvedId,
    };
    expect(blockedHarness.getHistory().at(-1)).toMatchObject({ role: 'assistant' });

    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('approval resumed')], 'gpt-4o-mini'));
    vi.mocked(approvalDb.getChatToolApproval).mockReturnValue(approvedRecord as never);
    vi.mocked(approvalDb.getChatToolApprovalSession).mockReturnValue({
      session_id: 'assistant_1',
      thread_id: 'thread_1',
      assistant_message_id: 'assistant_1',
      run_id: 'run_blocked_1',
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
    vi.mocked(approvalDb.getActiveChatToolApprovalsBySession).mockReturnValue([approvedRecord] as never);
    vi.mocked(agentRunDb.getAgentRun).mockReturnValue({
        id: 'run_blocked_1',
        kind: 'chat-turn',
        status: 'blocked',
        threadId: 'thread_1',
        parentRunId: null,
        rootRunId: 'run_blocked_1',
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'gpt-4o-mini',
        systemPrompt: 'system prompt',
        enabledTools: [toolName],
        availableSkillIds: [],
        input: { metadata: { maxIterations: 10 } },
        working: {
          modelMessages: blockedHarness.getHistory(),
          accumulatedText: '',
          pendingApprovalIds: [approvedId],
          lastStepIndex: 1,
        },
        output: { finishReason: 'approval-requested' },
        error: null,
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
    } as never);

    const activeStreams = new Map();
    const usage = { recordUsageEvent: vi.fn() };
    const target = { id: 7, send: vi.fn() };
    const approvals = createChatApproval({
      activeStreams,
      memory: { injectMemoryIntoMessages: vi.fn(messages => messages) } as never,
      usage,
    });

    const result = await approvals.approveTool(target, approvedId, true);

    expect(result).toEqual({ success: true, awaitingApproval: false, stopped: false });
    expect(approvalDb.answerChatToolApproval).toHaveBeenCalledWith(
      approvedId,
      'approved',
      'User approved tool execution.'
    );
    expect(approvalDb.consumeChatToolApprovalSession).toHaveBeenCalledWith('assistant_1');
    expect(createModelMock).toHaveBeenCalledWith('openai', 'gpt-4o-mini', 'provider_primary');
    expect(observedContext).toMatchObject({
      threadId: 'thread_1',
      hasRunTracker: true,
      conversationModel: {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'gpt-4o-mini',
      },
    });
    expect((observedContext as { runId?: string }).runId).toMatch(/^run_/);
    expect(usage.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'chat.approval-stream',
      threadId: 'thread_1',
      providerType: 'openai',
      model: 'gpt-4o-mini',
    }));
    expect(activeStreams.has(7)).toBe(false);

    const chunks = target.send.mock.calls
      .filter(call => call[0] === 'chat:ui-chunk')
      .map(call => call[1]);
    expect(chunks.map(chunk => chunk.type)).toEqual(expect.arrayContaining([
      'text-delta',
      'finish',
    ]));
  });
});
