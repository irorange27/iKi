import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());
const callPiChatMock = vi.hoisted(() => vi.fn());
const writeThreadTodoPlanMock = vi.hoisted(() => vi.fn());

// The supply seam: Pi is the only executor (ADR 009). Scripting it here keeps
// these suites on the durable-layer behaviour they assert without reaching a
// network endpoint.
vi.mock('@iki/backend/thread_session/turn_supply_selection', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/turn_supply_selection')>()),
  // `resolvePiTurnSupply` calls `getProviderConfig` INTERNALLY inside the
  // factory module, so mocking that module cannot reach it. These suites have
  // no provider table and do not test admission.
  pausedPlanRunsOnPiToolSupply: () => true,
}));

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    // No database in this suite: answer the provider lookup directly so the Pi
    // supply admits the turn (the address is never dialled — callPiChat is
    // mocked).
    getProviderConfig: vi.fn(() => ({
      type: 'openai',
      apiKey: 'key-test',
      baseURL: 'http://127.0.0.1:9/v1',
    })),
    getModelGenerationSettings: vi.fn(() => ({})),
  };
});

vi.mock('@iki/backend/db/thread_todos', () => ({
  writeThreadTodoPlan: writeThreadTodoPlanMock,
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  appendAgentRunStep: vi.fn(),
  appendAgentRunStepAndUpdateRun: vi.fn(
    (step: { runId: string; stepIndex: number }, updates: Record<string, unknown>) => ({
      id: step.runId,
      kind: 'chat-turn',
      status: updates.status ?? 'running',
      threadId: 'thread_1',
      rootRunId: step.runId,
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
    })
  ),
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
    kind: 'chat-turn',
    status: 'running',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
    ...updates,
  })),
}));

import { createMessageSend } from '@iki/backend/thread_session/message_send';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry, HandoffTool } from '@iki/backend/tools';

const toolName = 'message_send_context_probe';

describe('createMessageSend integration', () => {
  beforeEach(() => {
    // These suites drive the DURABLE layer (streaming, approvals, session-log
    // facts, retry, persistence) with a scripted AI SDK model. They are not about
    // which supply serves the turn, so they opt into the legacy executor: the
    // production default refuses a turn its projection cannot carry, and a
    // scripted model has no endpoint to project to.
    setTurnHarnessFallback(piTurnHarness);
    vi.clearAllMocks();
  });

  afterEach(() => {
    defaultToolRegistry.remove(toolName);
  });

  it('runs tool-enabled send through AgentHarness and preserves runtime context', async () => {
    let observedContext: unknown;
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe chat send runtime context',
        paramSchema: z.object({}),
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
      })
    );

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: toolName, args: {} },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const conversation = {
      createMessage: vi.fn(),
      upsertTurnMessage: vi.fn(),
    };
    const send = createMessageSend({
      tryAcquireThreadRun: () => () => undefined,
      checkThreadRunRate: () => ({ allowed: true }),
      usage: { recordUsageEvent: vi.fn() },
      conversation,

      turnPreparer: {
        prepareChatTurn: vi.fn(async () => ({
          report: { totalEstimatedTokens: 1 },
          usedSkills: [],
          selectedSkillIds: [],
          skillMode: 'manual' as const,
          finalMessages: [{ role: 'user' as const, content: 'run probe' }],
          history: [],
          prompt: 'run probe',
          guardActive: false,
          requireApproval: false,
          autoApproveToolRequests: false,
          affectSignal: null,
          interventionPolicy: null,
          guardedTools: [toolName],
          enableTools: true,
        })),
      } as never,
    }).send;

    const result = await send({
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      threadId: 'thread_1',
      messages: [{ id: 'msg_user_probe', role: 'user', content: 'run probe' }],
      tools: [toolName],
      maxIterations: 10,
    });

    if (!result.success) throw new Error(result.error);
    expect(result.text).toBe('done');
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
    expect(writeThreadTodoPlanMock).toHaveBeenCalledWith({ threadId: 'thread_1', items: [] });
    // The supply seam is Pi now: assert the model the turn was built with
    // rather than a constructor call that no longer exists.
    expect(callPiChatMock).toHaveBeenCalled();
    // Pi's model descriptor names the model `id`.
    expect((callPiChatMock.mock.calls[0] as unknown[])[0]).toMatchObject({
      id: 'gpt-4o-mini',
    });
    // Retro-review regressions: user message create-only, assistant output
    // upserted under the run-derived id. The persisted projection is the same
    // one streaming persists: the tool exchange plus the answer text (F4 —
    // transport must not decide which execution facts survive).
    expect(conversation.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'msg_user_probe',
        thread_id: 'thread_1',
      })
    );
    expect(conversation.upsertTurnMessage).toHaveBeenCalledTimes(1);
    const [turnRow] = conversation.upsertTurnMessage.mock.calls[0]! as [Record<string, unknown>];
    expect(turnRow.id).toMatch(/^assistant_run_/);
    expect(turnRow.message).toMatchObject({
      role: 'assistant',
      parts: expect.arrayContaining([
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: expect.any(String) }),
        expect.objectContaining({ type: 'text', text: 'done', state: 'done' }),
      ]),
    });
    const recordedSteps = vi
      .mocked(agentRunDb.appendAgentRunStepAndUpdateRun)
      .mock.calls.map(([step]) => step);
    expect(recordedSteps.some(step => step.type === 'tool-call' && !step.input?.toolCallId)).toBe(
      false
    );
    expect(
      recordedSteps.some(
        step =>
          step.type === 'model' &&
          step.output?.inference === true &&
          Array.isArray(step.output.content) &&
          step.output.content.some(
            part =>
              typeof part === 'object' &&
              part !== null &&
              'type' in part &&
              part.type === 'tool-call' &&
              'toolCallId' in part
          )
      )
    ).toBe(true);
    expect(
      recordedSteps.some(
        step =>
          step.type === 'model' &&
          step.output?.inference === true &&
          Array.isArray(step.output.content) &&
          step.output.content.some(
            part =>
              typeof part === 'object' &&
              part !== null &&
              'type' in part &&
              part.type === 'tool-result'
          )
      )
    ).toBe(true);
  });

  it('labels a send that exhausts its tool budget as budget-exhausted, not completed', async () => {
    // The send path now finalizes through the same terminal-outcome mapping
    // as streaming: a model that still wants tools when the iteration cap
    // hits ends 'budget-exhausted' (the old inline loop stamped 'completed').
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe budget exhaustion',
        paramSchema: z.object({}),
        needsApproval: false,
        handler: async () => 'observation',
      })
    );
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: toolName, args: {}, id: 'call_budget' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'must not run' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const send = createMessageSend({
      tryAcquireThreadRun: () => () => undefined,
      checkThreadRunRate: () => ({ allowed: true }),
      usage: { recordUsageEvent: vi.fn() },
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      turnPreparer: {
        prepareChatTurn: vi.fn(async () => ({
          report: { totalEstimatedTokens: 1 },
          usedSkills: [],
          selectedSkillIds: [],
          skillMode: 'manual' as const,
          finalMessages: [{ role: 'user' as const, content: 'keep probing' }],
          history: [],
          prompt: 'keep probing',
          guardActive: false,
          requireApproval: false,
          autoApproveToolRequests: false,
          affectSignal: null,
          interventionPolicy: null,
          guardedTools: [toolName],
          enableTools: true,
        })),
      } as never,
    }).send;

    expect(
      await send({
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'gpt-4o-mini',
        threadId: 'thread_budget',
        messages: [{ id: 'msg_budget', role: 'user', content: 'keep probing' }],
        tools: [toolName],
        maxIterations: 1,
      })
    ).toMatchObject({ success: true });

    const completedUpdate = vi
      .mocked(agentRunDb.appendAgentRunStepAndUpdateRun)
      .mock.calls.map(([, updates]) => updates)
      .filter(updates => updates.status === 'completed')
      .at(-1);
    expect(completedUpdate?.output).toMatchObject({ finishReason: 'budget-exhausted' });
  });

  it('finalizes a send that calls handoff with the handoff outcome and composed text', async () => {
    // Declared stage-B change: send rides the shared driver, so a model that
    // invokes the handoff tool ends with the driver's handoff outcome —
    // finishReason 'handoff' and the '[Handoff] …' block in the reply — the
    // same terminal contract the streaming path already had (the old inline
    // loop stamped 'completed' and dropped the handoff framing).
    defaultToolRegistry.register(new HandoffTool());
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: 'handoff',
            args: { summary: 'Found the leak', next_steps: 'Patch it', reason: 'context_limit' },
          },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'must not run' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const send = createMessageSend({
      tryAcquireThreadRun: () => () => undefined,
      checkThreadRunRate: () => ({ allowed: true }),
      usage: { recordUsageEvent: vi.fn() },
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      turnPreparer: {
        prepareChatTurn: vi.fn(async () => ({
          report: { totalEstimatedTokens: 1 },
          usedSkills: [],
          selectedSkillIds: [],
          skillMode: 'manual' as const,
          finalMessages: [{ role: 'user' as const, content: 'hand off the work' }],
          history: [],
          prompt: 'hand off the work',
          guardActive: false,
          requireApproval: false,
          autoApproveToolRequests: false,
          affectSignal: null,
          interventionPolicy: null,
          guardedTools: ['handoff'],
          enableTools: true,
        })),
      } as never,
    }).send;

    const result = await send({
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      threadId: 'thread_handoff',
      messages: [{ id: 'msg_handoff', role: 'user', content: 'hand off the work' }],
      tools: ['handoff'],
    });
    expect(result).toMatchObject({ success: true });
    // Reply text carries the in-turn handoff framing (same as streaming's
    // accumulated response), and the run row records the handoff outcome
    // with the composed next-steps block — not a plain 'completed'.
    expect(result.text).toContain('[Handoff #1] Found the leak');

    const completedUpdate = vi
      .mocked(agentRunDb.appendAgentRunStepAndUpdateRun)
      .mock.calls.map(([, updates]) => updates)
      .filter(updates => updates.status === 'completed')
      .at(-1);
    expect(completedUpdate?.output).toMatchObject({ finishReason: 'handoff' });
    expect(String(completedUpdate?.output?.text)).toContain('Next steps: Patch it');
  });

  it('leaves no durable rows when the thread rate limit rejects the send', async () => {
    const conversation = {
      createMessage: vi.fn(),
      upsertTurnMessage: vi.fn(),
    };
    const send = createMessageSend({
      tryAcquireThreadRun: () => () => undefined,
      checkThreadRunRate: () => ({ allowed: false, retryAfterMs: 1000 }),
      usage: { recordUsageEvent: vi.fn() },
      turnPreparer: {
        prepareChatTurn: vi.fn(async () => {
          throw new Error('must not reach turn preparation');
        }),
      },
      conversation,
    } as never).send;

    const result = await send({
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      threadId: 'thread_1',
      messages: [{ id: 'msg_rate_probe', role: 'user', content: 'rate limited' }],
    });

    expect(result.success).toBe(false);
    // With a client id present, a persist that runs before admission would
    // call createMessage — the assertion below is what pins the ordering.
    expect(conversation.createMessage).not.toHaveBeenCalled();
    expect(conversation.upsertTurnMessage).not.toHaveBeenCalled();
  });
});
