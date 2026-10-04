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
  upsertToolCallApprovalSession: vi.fn(),
  upsertToolCallApprovals: vi.fn(),
}));

vi.mock('@iki/backend/db/chat_message', () => ({
  getChatMessages: vi.fn(() => []),
  getChatMessage: vi.fn(() => undefined),
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  appendAgentRunStep: vi.fn(),
  appendAgentRunStepAndUpdateRun: vi.fn((step: Record<string, unknown>, updates: Record<string, unknown>) => ({
    id: (step as { runId: string }).runId,
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
      lastStepIndex: (step as { stepIndex: number }).stepIndex,
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
    parentRunId: 'run_blocked_1',
    rootRunId: 'run_blocked_1',
    providerType: 'openai',
    model: 'test-model',
    systemPrompt: 'system prompt',
    enabledTools: [],
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

import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';
import { AgentHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const toolName = 'autonomous_resume_probe';

const makePlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  providerType: 'openai',
  model: 'test-model',
  enableTools: true,
  enabledTools: [toolName],
  availableSkillIds: [],
  guardActive: false,
  // The paused turn already asked its approval; the continuation auto-runs
  // the remaining steps (same contract the streaming resume restores).
  requireApproval: false,
  autoApproveToolRequests: false,
  maxIterations: 1,
  systemPrompt: 'system prompt',
  skillMode: 'manual',
  kind: 'chat-turn',
  runMetadata: {},
  transport: 'stream',
  threadId: 'thread_1',
  ...overrides,
});

// F7 boundary: an approval pause must not cost the turn its outer lifecycle.
// The paused plan was autonomous — the approved continuation rides the same
// turn driver, keeps consuming the autonomous budget (the continuePrompt
// reaches the model across batch boundaries) and terminates with the
// driver's own outcome, instead of running exactly one orphan batch the way
// the old dedicated resume loop did.
describe('approval resume rides the autonomous outer loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    defaultToolRegistry.remove(toolName);
  });

  it('continues batching after the approval and lets the continuePrompt reach the model', async () => {
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe autonomous resume',
        paramSchema: z.object({}),
        needsApproval: false,
        handler: async () => 'observed',
      })
    );

    // Pause on a real approval request, exactly as the streaming path would.
    const blockedModel = new FauxModelProvider([
      fauxToolCall(toolName, {}, { id: 'call_paused' }),
    ]);
    const blockedHarness = new AgentHarness({
      providerType: 'openai',
      model: 'test-model',
      systemPrompt: 'system prompt',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      approvalPolicy: 'always',
      maxIterations: 10,
      modelFactory: () => blockedModel,
    });
    const blockedEvents: Array<{ event: string; step?: { type: string; requests?: Array<{ approvalId: string }> } }> = [];
    await runWithToolRuntimeContext(
      { threadId: 'thread_1', runId: 'run_blocked_1' },
      async () => {
        for await (const event of blockedHarness.turn({ prompt: 'run the probe' })) {
          blockedEvents.push(event as never);
        }
      }
    );
    const approvalRequest = blockedEvents.find(
      event => event.event === 'step' && event.step?.type === 'approval_request'
    );
    expect(approvalRequest).toBeDefined();
    const approvalId = approvalRequest!.step!.requests![0].approvalId;
    const pausedHistory = blockedHarness.getHistory();

    // One tool call per SDK step (maxIterations 1) — every batch ends with
    // finishReason 'tool-calls', so the outer loop must keep batching until
    // its own budget (3 batches × 1 step) is spent.
    const model = new FauxModelProvider([
      fauxToolCall(toolName, {}, { id: 'call_r1' }),
      fauxToolCall(toolName, {}, { id: 'call_r2' }),
      fauxToolCall(toolName, {}, { id: 'call_r3' }),
      fauxText('must not be reached'),
    ]);
    const doStream = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const streamCoordinator = createThreadStreamCoordinator();
    const approvals = createChatApproval({
      streams: {
        tryAcquireThreadRun: streamCoordinator.tryAcquireThreadRun,
        peek: streamCoordinator.peekStream,
        attach: streamCoordinator.attachStream,
        detach: streamCoordinator.detachStream,
      },
      memory: { injectMemoryIntoMessages: vi.fn(messages => messages) } as never,
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      usage: { recordUsageEvent: vi.fn() },
    });

    approvals.registerApprovalBatch(
      [
        {
          approvalId,
          toolCallId: 'call_paused',
          toolCall: { toolName, args: {} },
        },
      ],
      {
        target: { id: 7, send: vi.fn() },
        history: pausedHistory,
        recoveryContext: {
          plan: makePlan({
            autonomous: { maxIterations: 3, continuePrompt: 'CONTINUE_THE_PAUSED_WORK' },
          }),
          sessionId: 'assistant_1',
          assistantMessageId: 'assistant_1',
          runId: 'run_blocked_1',
        },
      }
    );

    const result = await approvals.approveTool({ id: 7, send: vi.fn() }, approvalId, true);
    expect(result).toMatchObject({ success: true });

    // Three autonomous batches, each exactly one SDK step: 3 provider calls.
    // The pre-driver resume loop ran one batch and stopped (1 call).
    expect(doStream).toHaveBeenCalledTimes(3);

    // The continuePrompt rides the batch boundary: a post-approval request
    // (batch 2+) must carry it into the model context.
    const laterPrompts = doStream.mock.calls
      .slice(1)
      .map(([options]) => JSON.stringify((options as { prompt?: unknown }).prompt));
    expect(laterPrompts.join('\n')).toContain('CONTINUE_THE_PAUSED_WORK');

    const budgetOutcome = vi
      .mocked(agentRunDb.appendAgentRunStepAndUpdateRun)
      .mock.calls.map(([, updates]) => updates)
      .filter(updates => updates.status === 'completed')
      .at(-1);
    expect(budgetOutcome?.output).toMatchObject({ finishReason: 'budget-exhausted' });
  });
});
