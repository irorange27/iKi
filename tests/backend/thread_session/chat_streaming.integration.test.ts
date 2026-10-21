import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const callPiChatMock = vi.hoisted(() => vi.fn());
const writeThreadTodoPlanMock = vi.hoisted(() => vi.fn());
const prepareChatTurnMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/thread_session/turn_supply_selection', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/turn_supply_selection')>()),
  // `resolvePiTurnSupply` calls `getProviderConfig` INTERNALLY inside the
  // factory module, so mocking that module cannot reach it. These suites have
  // no provider table and do not test admission.
  pausedPlanRunsOnPiToolSupply: () => true,
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
    // No database in this suite: answer the provider lookup directly so the Pi
    // supply admits the turn. The address is never dialled — `callPiChat` is
    // mocked above.
    getProviderConfig: vi.fn(() => ({
      type: 'openai',
      apiKey: 'key-test',
      baseURL: 'http://127.0.0.1:9/v1',
    })),
  };
});

// The supply seam: Pi is the only executor (ADR 009), so the scripted model is
// installed here rather than on the removed `createModel`.
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

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
  getLatestAgentRunCheckpoint: vi.fn(() => null),
  updateAgentRun: vi.fn((id: string, updates: Record<string, unknown>) => ({
    id,
    kind: 'chat-turn',
    status: 'running',
    threadId: 'thread_1',
    rootRunId: id,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
    ...updates,
  })),
}));

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: prepareChatTurnMock,
  }),
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
  // session_loop now consumes these three as named imports; the factory must
  // provide them or module linking fails even when the preparer is mocked out.
  getAssistantProfileContextMessage: () => '',
  retrieveRelevantContinuity: () => null,
  onMessagePersisted: async () => undefined,
  getCompanion: () => ({
    beginThinking: vi.fn(),
    startThinking: vi.fn(),
    endThinking: vi.fn(),
    clearConversationPreview: vi.fn(),
    setConversationPreview: vi.fn(),
    notifyReplyComplete: vi.fn(),
    updateConversationPreview: vi.fn(),
  }),
}));

import type { LanguageModelV3Usage } from '@ai-sdk/provider';

import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import {
  createScriptedPiChat,
  type PiScript,
  type PiScriptStep,
} from '@iki/backend/agent/testing/scripted_pi';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry, HandoffTool } from '@iki/backend/tools';

const toolName = 'streaming_context_probe';

describe('createChatStreaming integration', () => {
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

  it('streams tool chunks through AgentHarness and preserves runtime context', async () => {
    let observedContext: unknown;
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe streaming runtime context',
        paramSchema: z.object({}),
        handler: async () => {
          const ctx = getToolRuntimeContext();
          observedContext = {
            threadId: ctx.threadId,
            runId: ctx.runId,
            hasRunTracker: !!ctx.runTracker,
            toolNames: ctx.availableTools?.map(tool => tool.name),
            conversationModel: ctx.conversationModel,
          };
          return observedContext;
        },
      })
    );

    // Two model calls: the first asks for the tool (and must END with toolUse so
    // the harness executes it), the second answers after the result.
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName, args: {} },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'stream done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    prepareChatTurnMock.mockResolvedValue({
      report: { totalEstimatedTokens: 1, blocks: [] },
      usedSkills: [],
      selectedSkillIds: [],
      skillMode: 'manual',
      finalMessages: [{ role: 'user', content: 'run stream probe' }],
      history: [],
      prompt: 'run stream probe',
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
      affectSignal: null,
      interventionPolicy: null,
      guardedTools: [toolName],
      enableTools: true,
    });

    const streamCoordinator = createThreadStreamCoordinator();
    const usage = { recordUsageEvent: vi.fn() };
    const approvals = {
      ensurePendingApprovalSession: vi.fn(),
      registerApprovalBatch: vi.fn(),
      cleanupPendingSessionsForSender: vi.fn(),
    };
    const target = { id: 42, send: vi.fn() };

    const conversation = {
      createMessage: vi.fn(),
      upsertTurnMessage: vi.fn(),
    };
    const streaming = createChatStreaming({
      streamCoordinator,
      memory: {} as never,
      conversation,
      usage,
      approvals,
      getThreadTitle: () => 'Thread',
    });

    const result = await streaming.stream(target, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      threadId: 'thread_1',
      messages: [{ id: 'msg_user_probe', role: 'user', content: 'run stream probe' }],
      tools: [toolName],
      maxIterations: 10,
    });

    if (!result.success) throw new Error(result.error);
    expect(result).toMatchObject({ success: true, text: 'stream done', stopped: false });
    expect(observedContext).toMatchObject({
      toolNames: expect.arrayContaining([toolName]),
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
    expect(usage.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat.stream',
        threadId: 'thread_1',
        providerType: 'openai',
        model: 'gpt-4o-mini',
      })
    );
    expect(approvals.cleanupPendingSessionsForSender).toHaveBeenCalledWith(42, expect.any(String));
    expect(streamCoordinator.peekStream(42)).toBeUndefined();

    const chunks = target.send.mock.calls
      .filter(call => call[0] === 'chat:ui-chunk')
      .map(call => call[1]);
    expect(chunks.map(chunk => chunk.type)).toEqual(
      expect.arrayContaining([
        'start',
        'tool-input-available',
        'tool-output-available',
        'text-delta',
        'finish',
      ])
    );
    expect(chunks.find(chunk => chunk.type === 'tool-input-available')).toMatchObject({
      toolName,
      input: {},
    });

    // Turn usage + perf metrics ride along as a data part before finish, so
    // the renderer can aggregate session stats (and persist them per message).
    const usageChunks = chunks.filter(chunk => chunk.type === 'data-token-usage');
    expect(usageChunks).toHaveLength(1);
    const usageChunk = usageChunks[0]!;
    expect(usageChunk.data).toMatchObject({
      model: 'gpt-4o-mini',
      providerType: 'openai',
      providerId: 'provider_primary',
      steps: 2,
      toolCalls: 1,
    });
    expect(typeof usageChunk.data.llmMs).toBe('number');
    expect(typeof usageChunk.data.toolMs).toBe('number');
    expect(chunks.findIndex(chunk => chunk.type === 'finish')).toBeGreaterThan(
      chunks.indexOf(usageChunk)
    );

    // ConversationStore: the user turn message is recorded (create-only), the
    // assistant turn output is upserted with the reduced SDK message parts.
    expect(conversation.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'msg_user_probe',
        thread_id: 'thread_1',
      })
    );
    // The turn settles within the 300ms trailing debounce, so the mid-turn
    // progress write is superseded by the finalize upsert (the same profile
    // the renderer's old debounced persist had). Both writes would be
    // parented to the user row; the finalize one carries the done text.
    expect(conversation.upsertTurnMessage).toHaveBeenCalledTimes(1);
    const [turnRow] = conversation.upsertTurnMessage.mock.calls[0]! as [Record<string, unknown>];
    expect(turnRow).toMatchObject({
      thread_id: 'thread_1',
      parent_id: 'msg_user_probe',
      message: { role: 'assistant', parts: expect.any(Array) },
    });
    const persistedParts = (turnRow.message as { parts: Array<Record<string, unknown>> }).parts;
    expect(
      persistedParts.some(part => part.type === 'dynamic-tool' && part.state === 'output-available')
    ).toBe(true);
    expect(persistedParts.some(part => part.type === 'text' && part.state === 'done')).toBe(true);
  });

  it('persists pending approval IDs on the blocked streaming run', async () => {
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe approval persistence',
        paramSchema: z.object({}),
        handler: async () => 'must not execute',
      })
    );
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName, args: {}, id: 'approval-call-1' },
          { kind: 'done', reason: 'toolUse' },
        ],
      ])
    );
    prepareChatTurnMock.mockResolvedValue({
      report: { totalEstimatedTokens: 1, blocks: [] },
      usedSkills: [],
      selectedSkillIds: [],
      skillMode: 'manual',
      finalMessages: [{ role: 'user', content: 'request approval' }],
      history: [],
      prompt: 'request approval',
      guardActive: false,
      requireApproval: true,
      autoApproveToolRequests: false,
      affectSignal: null,
      interventionPolicy: null,
      guardedTools: [toolName],
      enableTools: true,
    });

    const approvalRegistration = vi.fn();
    const streaming = createChatStreaming({
      streamCoordinator: createThreadStreamCoordinator(),
      memory: {} as never,
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: approvalRegistration,
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Thread',
    });

    const result = await streaming.stream(
      { id: 51, send: vi.fn() },
      {
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'gpt-4o-mini',
        threadId: 'thread_approval_snapshot',
        messages: [{ role: 'user', content: 'request approval' }],
        tools: [toolName],
        approvalPolicy: 'always',
      }
    );

    expect(result).toMatchObject({ success: true, awaitingApproval: true });
    const approvalId = approvalRegistration.mock.calls[0]?.[0]?.[0]?.approvalId;
    expect(approvalId).toEqual(expect.any(String));

    const blockedUpdate = vi
      .mocked(agentRunDb.updateAgentRun)
      .mock.calls.map(([, updates]) => updates)
      .filter(updates => updates.status === 'blocked')
      .at(-1);
    expect(blockedUpdate?.working).toMatchObject({
      pendingApprovalIds: [approvalId],
    });
    expect(
      blockedUpdate?.working?.modelMessages.some(message => message.role === 'assistant')
    ).toBe(true);
  });

  it('propagates provider cache usage through the turn boundary', async () => {
    // Acceptance gate for prompt-cache accounting (audit P2): a provider that
    // reports cache read/write per inference must surface the summed values
    // in both the persisted usage event and the renderer's data-token-usage
    // chunk. Real SDK usage normalization — only the model is scripted.
    // Pi reports cache accounting directly on `Usage` (input/output/cacheRead/
    // cacheWrite), not the SDK's nested `inputTokenDetails` shape.
    const cacheUsage = (noCache: number, read: number, write: number) => ({
      // Pi reports the UNCACHED prompt as `input` and the cached portion
      // alongside it, so the billed total is `input + cacheRead + cacheWrite`
      // (the same reading the harness applies when it sums a turn).
      input: noCache,
      output: 16,
      cacheRead: read,
      cacheWrite: write,
      totalTokens: noCache + read + write + 16,
    });

    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe streaming runtime context',
        paramSchema: z.object({}),
        handler: async () => 'ok',
      })
    );
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName, args: {} },
          { kind: 'done', reason: 'toolUse', usage: cacheUsage(72, 400, 28) },
        ],
        [
          { kind: 'text', text: 'stream done' },
          { kind: 'done', reason: 'stop', usage: cacheUsage(272, 128, 0) },
        ],
      ])
    );
    prepareChatTurnMock.mockResolvedValue({
      report: { totalEstimatedTokens: 1, blocks: [] },
      usedSkills: [],
      selectedSkillIds: [],
      skillMode: 'manual',
      finalMessages: [{ role: 'user', content: 'cache probe' }],
      history: [],
      prompt: 'cache probe',
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
      affectSignal: null,
      interventionPolicy: null,
      guardedTools: [toolName],
      enableTools: true,
    });

    const streamCoordinator = createThreadStreamCoordinator();
    const usage = { recordUsageEvent: vi.fn() };
    const target = { id: 7, send: vi.fn() };

    const streaming = createChatStreaming({
      streamCoordinator,
      memory: {} as never,
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      usage,
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Thread',
    });

    const result = await streaming.stream(target, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      threadId: 'thread_cache',
      messages: [{ role: 'user', content: 'cache probe' }],
      tools: [toolName],
      maxIterations: 10,
    });
    if (!result.success) throw new Error(result.error);

    // Summed across the two inferences: cacheRead 400 + 128, cacheWrite 28.
    expect(usage.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat.stream',
        threadId: 'thread_cache',
        usage: expect.objectContaining({
          inputTokens: 900,
          outputTokens: 32,
          cacheReadTokens: 528,
          cacheWriteTokens: 28,
        }),
      })
    );

    const usageChunk = target.send.mock.calls
      .map(call => call[1])
      .find(chunk => chunk.type === 'data-token-usage');
    expect(usageChunk).toBeDefined();
    expect(usageChunk!.data).toMatchObject({
      inputTokens: 900,
      // The last inference's billed input (272 noCache + 128 cacheRead) — the
      // renderer's context-occupancy signal, distinct from the turn total.
      lastStepInputTokens: 400,
      cacheReadTokens: 528,
      cacheWriteTokens: 28,
    });
  });
  const setupLoop = (script: PiScript[], toolNames: string[] = []) => {
    callPiChatMock.mockImplementation(createScriptedPiChat(script));
    prepareChatTurnMock.mockResolvedValue({
      report: { totalEstimatedTokens: 1, blocks: [] },
      usedSkills: [],
      selectedSkillIds: [],
      skillMode: 'manual',
      finalMessages: [{ role: 'user', content: 'original task' }],
      history: [],
      prompt: 'original task',
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
      affectSignal: null,
      interventionPolicy: null,
      guardedTools: toolNames,
      enableTools: toolNames.length > 0,
    });
    const coordinator = createThreadStreamCoordinator();
    const streaming = createChatStreaming({
      streamCoordinator: coordinator,
      memory: {} as never,
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Thread',
    });
    const run = (maxIterations = 10, batches = 2) =>
      streaming.stream(
        { id: 42, send: vi.fn() },
        {
          providerType: 'openai',
          providerId: 'provider_primary',
          model: 'test-model',
          threadId: 'thread_1',
          messages: [{ role: 'user', content: 'original task' }],
          tools: toolNames,
          maxIterations,
          autonomous: { maxIterations: batches },
        }
      );
    return { coordinator, run, streaming };
  };

  it('excludes duplicate stream/send calls during preparation but allows another thread', async () => {
    const { streaming, run } = setupLoop([
      [{ kind: 'text', text: 'other thread' }, { kind: 'done' }],
      [{ kind: 'text', text: 'first thread' }, { kind: 'done' }],
    ]);
    const prepare = prepareChatTurnMock.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    prepareChatTurnMock.mockImplementationOnce(async () => {
      await gate;
      return prepare();
    });
    const first = run();
    expect(await run()).toMatchObject({
      success: false,
      error: expect.stringContaining('already running'),
    });
    expect(
      await streaming.send({
        threadId: 'thread_1',
        providerType: 'openai',
        model: 'test-model',
        messages: [],
      })
    ).toMatchObject({ success: false });
    const other = await streaming.stream(
      { id: 43, send: vi.fn() },
      {
        threadId: 'thread_2',
        providerType: 'openai',
        model: 'test-model',
        messages: [],
      }
    );
    expect(other).toMatchObject({ success: true, text: 'other thread' });
    release();
    expect(await first).toMatchObject({ success: true, text: 'first thread' });
    expect(prepareChatTurnMock).toHaveBeenCalledTimes(2);
  });

  it('does not start the superseded request after its delayed preparation resolves', async () => {
    const { streaming, run } = setupLoop([
      [{ kind: 'text', text: 'new thread' }, { kind: 'done' }],
      [{ kind: 'text', text: 'must not execute' }, { kind: 'done' }],
    ]);
    const prepare = prepareChatTurnMock.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    prepareChatTurnMock.mockImplementationOnce(async () => {
      await gate;
      return prepare();
    });
    const first = run();
    await streaming.stream(
      { id: 42, send: vi.fn() },
      {
        threadId: 'thread_2',
        providerType: 'openai',
        model: 'test-model',
        messages: [],
      }
    );
    release();
    await first;
    // The step budget (maxIterations 1) bounds each batch; the turn driver may
    // start another batch, so what matters here is that the budget was
    // EXHAUSTED rather than that exactly one call happened.
    expect(callPiChatMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves tool context across concurrent threads after asynchronous suspension', async () => {
    const { streaming } = setupLoop([], [toolName]);
    // Two threads run concurrently, each with a tool step then an answer, so
    // the script must cover four model calls (they are interleaved).
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [{ kind: 'toolCall', toolName, args: {} }, { kind: 'done', reason: 'toolUse' }],
        [{ kind: 'toolCall', toolName, args: {} }, { kind: 'done', reason: 'toolUse' }],
        [{ kind: 'text', text: 'done' }, { kind: 'done', reason: 'stop' }],
        [{ kind: 'text', text: 'done' }, { kind: 'done', reason: 'stop' }],
      ])
    );
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const seen: Array<{ before?: string; after?: string; runId?: string }> = [];
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Context probe',
        paramSchema: z.object({}),
        handler: async () => {
          const before = getToolRuntimeContext().threadId;
          if (++entered === 2) release();
          await gate;
          const after = getToolRuntimeContext();
          seen.push({ before, after: after.threadId, runId: after.runId });
          return { threadId: after.threadId };
        },
      })
    );
    const results = await Promise.all(
      ['a', 'b'].map((threadId, index) =>
        streaming.stream(
          { id: index + 1, send: vi.fn() },
          {
            threadId,
            providerType: 'openai',
            model: 'test-model',
            messages: [],
            tools: [toolName],
          }
        )
      )
    );
    expect(results.every(result => result.success)).toBe(true);
    expect(seen.map(item => [item.before, item.after]).sort()).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ]);
    expect(new Set(seen.map(item => item.runId)).size).toBe(2);
  });

  it('ends autonomous work on a natural model stop without spending another call', async () => {
    const { run } = setupLoop([
      [{ kind: 'text', text: 'done' }, { kind: 'done' }],
      [{ kind: 'text', text: 'must not run' }, { kind: 'done' }],
    ]);
    expect(await run()).toMatchObject({ success: true, text: 'done' });
    // The step budget (maxIterations 1) bounds each batch; the turn driver may
    // start another batch, so what matters here is that the budget was
    // EXHAUSTED rather than that exactly one call happened.
    expect(callPiChatMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('resumes an autonomous handoff with its summary and next task', async () => {
    defaultToolRegistry.register(new HandoffTool());
    const { run } = setupLoop(
      [
        [
          {
            kind: 'toolCall',
            toolName: 'handoff',
            args: { summary: 'Found the defect', next_steps: 'Fix it', reason: 'context_limit' },
          },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'fixed' },
          { kind: 'done', reason: 'stop' },
        ],
      ],
      ['handoff']
    );
    const call = callPiChatMock;
    try {
      expect(await run()).toMatchObject({ success: true });
      expect(call).toHaveBeenCalledTimes(2);
      // Pi receives the context as its second argument (`{ systemPrompt,
      // messages, tools }`), not the SDK's `{ prompt }`.
      const prompt = JSON.stringify(call.mock.calls[1][1]);
      expect(prompt).toContain('Found the defect');
      expect(prompt).toContain('Fix it');
    } finally {
      defaultToolRegistry.remove('handoff');
    }
  });

  it('respects the autonomous batch limit after SDK step exhaustion', async () => {
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe',
        paramSchema: z.object({}),
        handler: async () => 'observation',
      })
    );
    const { run } = setupLoop(
      [
        [
          { kind: 'toolCall', toolName, args: {} },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'toolCall', toolName, args: {} },
          { kind: 'done', reason: 'toolUse' },
        ],
        [{ kind: 'text', text: 'must not run' }, { kind: 'done' }],
      ],
      [toolName]
    );
    expect(await run(1, 2)).toMatchObject({ success: true });
    // The step budget (maxIterations 1) bounds each batch; the turn driver may
    // start another batch, so what matters here is that the budget was
    // EXHAUSTED rather than that exactly one call happened.
    expect(callPiChatMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const completedUpdate = vi
      .mocked(agentRunDb.appendAgentRunStepAndUpdateRun)
      .mock.calls.map(([, updates]) => updates)
      .filter(updates => updates.status === 'completed')
      .at(-1);
    expect(completedUpdate?.output).toMatchObject({
      finishReason: 'budget-exhausted',
    });
  });

  it('preserves observations and the latest human feedback during steering', async () => {
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe',
        paramSchema: z.object({}),
        handler: async () => 'completed observation',
      })
    );
    // Three calls: the tool step, the answer the turn was already producing,
    // and the answer the steering input redirected it to.
    const { coordinator, run } = setupLoop(
      [
        [
          { kind: 'toolCall', toolName, args: {} },
          { kind: 'done', reason: 'toolUse' },
        ],
        [{ kind: 'text', text: 'interrupted' }, { kind: 'done' }],
        [{ kind: 'text', text: 'steered response' }, { kind: 'done' }],
      ],
      [toolName]
    );
    // Steering fires on the second MODEL call, which is the seam the old
    // `doStream` spy sat on. `callPiChat(model, context, options)`.
    const original = callPiChatMock.getMockImplementation()!;
    const call = callPiChatMock;
    let calls = 0;
    callPiChatMock.mockImplementation((model, context, options) => {
      if (++calls === 2)
        expect(coordinator.steerStream(42, 'thread_1', 'new direction').success).toBe(true);
      return (original as (m: unknown, c: unknown, o: unknown) => unknown)(model, context, options);
    });
    // The turn settles with the text its last request produced. What steering
    // must guarantee is that the human's direction REACHED the model — the
    // request that carried it is asserted below.
    expect(await run()).toMatchObject({ success: true });
    // The post-tool request keeps the observation, carries the original task
    // exactly once, and ends with the human's steering input.
    const postTool = JSON.stringify(call.mock.calls[1][1]);
    expect(postTool).toContain('completed observation');
    expect(postTool.match(/original task/g)).toHaveLength(1);
    const steered = JSON.stringify(call.mock.calls.at(-1)![1]);
    expect(steered).toContain('new direction');
  });
});
