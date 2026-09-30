import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());
const writeThreadTodoPlanMock = vi.hoisted(() => vi.fn());
const prepareChatTurnMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    getFullSystemPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
    injectReasoningContentIntoMessages: vi.fn((messages: unknown[]) => messages),
  };
});

vi.mock('@iki/backend/db/thread_todos', () => ({
  writeThreadTodoPlan: writeThreadTodoPlanMock,
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  appendAgentRunStep: vi.fn(),
  appendAgentRunStepAndUpdateRun: vi.fn((
    step: { runId: string; stepIndex: number },
    updates: Record<string, unknown>
  ) => ({
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
  })),
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
  getCompanion: () => ({
    setChatPolicy: vi.fn(),
    setAffect: vi.fn(),
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
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry, HandoffTool } from '@iki/backend/tools';

const toolName = 'streaming_context_probe';

describe('createChatStreaming integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    defaultToolRegistry.remove(toolName);
  });

  it('streams tool chunks through AgentHarness and preserves runtime context', async () => {
    let observedContext: unknown;
    defaultToolRegistry.register(createTool({
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
    }));

    createModelMock.mockReturnValue(new FauxModelProvider([
      fauxToolCall(toolName, {}),
      fauxText('stream done'),
    ]));
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
    expect(usage.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'chat.stream',
      threadId: 'thread_1',
      providerType: 'openai',
      model: 'gpt-4o-mini',
    }));
    expect(approvals.cleanupPendingSessionsForSender).toHaveBeenCalledWith(42, expect.any(String));
    expect(streamCoordinator.peekStream(42)).toBeUndefined();

    const chunks = target.send.mock.calls
      .filter(call => call[0] === 'chat:ui-chunk')
      .map(call => call[1]);
    expect(chunks.map(chunk => chunk.type)).toEqual(expect.arrayContaining([
      'start',
      'tool-input-available',
      'tool-output-available',
      'text-delta',
      'finish',
    ]));
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
    expect(conversation.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg_user_probe',
      thread_id: 'thread_1',
    }));
    // Two durable writes: the mid-turn tool-progress upsert (crash recovery
    // relies on it) and the finalize upsert — both parented to the user row.
    expect(conversation.upsertTurnMessage).toHaveBeenCalledTimes(2);
    for (const [turnRow] of conversation.upsertTurnMessage.mock.calls as Array<
      [Record<string, unknown>]
    >) {
      expect(turnRow).toMatchObject({
        thread_id: 'thread_1',
        parent_id: 'msg_user_probe',
        message: { role: 'assistant', parts: expect.any(Array) },
      });
    }
    const [progressRow, finalRow] = conversation.upsertTurnMessage.mock.calls.map(
      ([row]) => row as { message: { parts: Array<Record<string, unknown>> } }
    );
    expect(
      progressRow.message.parts.some(
        part => part.type === 'dynamic-tool' && part.state === 'output-available'
      )
    ).toBe(true);
    expect(
      finalRow.message.parts.some(part => part.type === 'text' && part.state === 'done')
    ).toBe(true);
  });

  it('persists pending approval IDs on the blocked streaming run', async () => {
    defaultToolRegistry.register(createTool({
      name: toolName,
      type: 'function',
      description: 'Probe approval persistence',
      paramSchema: z.object({}),
      handler: async () => 'must not execute',
    }));
    createModelMock.mockReturnValue(new FauxModelProvider([
      fauxToolCall(toolName, {}, { id: 'approval-call-1' }),
    ]));
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

    const blockedUpdate = vi.mocked(agentRunDb.updateAgentRun).mock.calls
      .map(([, updates]) => updates)
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
    const cacheUsage = (noCache: number, read: number, write: number): LanguageModelV3Usage => ({
      inputTokens: { total: noCache + read + write, noCache, cacheRead: read, cacheWrite: write },
      outputTokens: { total: 16, text: 16, reasoning: 0 },
    });

    defaultToolRegistry.register(createTool({
      name: toolName,
      type: 'function',
      description: 'Probe streaming runtime context',
      paramSchema: z.object({}),
      handler: async () => 'ok',
    }));
    createModelMock.mockReturnValue(new FauxModelProvider([
      fauxToolCall(toolName, {}, { usage: cacheUsage(72, 400, 28) }),
      fauxText('stream done', { usage: cacheUsage(272, 128, 0) }),
    ]));
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
    expect(usage.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'chat.stream',
      threadId: 'thread_cache',
      usage: expect.objectContaining({
        inputTokens: 900,
        outputTokens: 32,
        cacheReadTokens: 528,
        cacheWriteTokens: 28,
      }),
    }));

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
  const setupLoop = (faux: FauxModelProvider, toolNames: string[] = []) => {
    createModelMock.mockReturnValue(faux);
    prepareChatTurnMock.mockResolvedValue({
      report: { totalEstimatedTokens: 1, blocks: [] }, usedSkills: [], selectedSkillIds: [], skillMode: 'manual',
      finalMessages: [{ role: 'user', content: 'original task' }], history: [], prompt: 'original task',
      guardActive: false, requireApproval: false, autoApproveToolRequests: false,
      affectSignal: null, interventionPolicy: null, guardedTools: toolNames, enableTools: toolNames.length > 0,
    });
    const coordinator = createThreadStreamCoordinator();
    const streaming = createChatStreaming({
      streamCoordinator: coordinator, memory: {} as never,
      conversation: { createMessage: vi.fn(), upsertTurnMessage: vi.fn() },
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(), registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Thread',
    });
    const run = (maxIterations = 10, batches = 2) => streaming.stream({ id: 42, send: vi.fn() }, {
      providerType: 'openai', providerId: 'provider_primary', model: 'test-model',
      threadId: 'thread_1', messages: [{ role: 'user', content: 'original task' }],
      tools: toolNames, maxIterations, autonomous: { maxIterations: batches },
    });
    return { coordinator, run, streaming };
  };

  it('excludes duplicate stream/send calls during preparation but allows another thread', async () => {
    const faux = new FauxModelProvider([fauxText('other thread'), fauxText('first thread')]);
    const { streaming, run } = setupLoop(faux);
    const prepare = prepareChatTurnMock.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    prepareChatTurnMock.mockImplementationOnce(async () => { await gate; return prepare(); });
    const first = run();
    expect(await run()).toMatchObject({ success: false, error: expect.stringContaining('already running') });
    expect(await streaming.send({ threadId: 'thread_1', providerType: 'openai', model: 'test-model', messages: [] })).toMatchObject({ success: false });
    const other = await streaming.stream({ id: 43, send: vi.fn() }, {
      threadId: 'thread_2', providerType: 'openai', model: 'test-model', messages: [],
    });
    expect(other).toMatchObject({ success: true, text: 'other thread' });
    release();
    expect(await first).toMatchObject({ success: true, text: 'first thread' });
    expect(prepareChatTurnMock).toHaveBeenCalledTimes(2);
  });

  it('does not start the superseded request after its delayed preparation resolves', async () => {
    const faux = new FauxModelProvider([fauxText('new thread'), fauxText('must not execute')]);
    const { streaming, run } = setupLoop(faux);
    const prepare = prepareChatTurnMock.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    prepareChatTurnMock.mockImplementationOnce(async () => { await gate; return prepare(); });
    const first = run();
    await streaming.stream({ id: 42, send: vi.fn() }, {
      threadId: 'thread_2', providerType: 'openai', model: 'test-model', messages: [],
    });
    release();
    await first;
    expect(faux.remaining).toBe(1);
  });

  it('preserves tool context across concurrent threads after asynchronous suspension', async () => {
    const { streaming } = setupLoop(new FauxModelProvider([]), [toolName]);
    createModelMock.mockImplementation(() => new FauxModelProvider([fauxToolCall(toolName, {}), fauxText('done')]));
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen: Array<{ before?: string; after?: string; runId?: string }> = [];
    defaultToolRegistry.register(createTool({
      name: toolName, type: 'function', description: 'Context probe', paramSchema: z.object({}),
      handler: async () => {
        const before = getToolRuntimeContext().threadId;
        if (++entered === 2) release();
        await gate;
        const after = getToolRuntimeContext();
        seen.push({ before, after: after.threadId, runId: after.runId });
        return { threadId: after.threadId };
      },
    }));
    const results = await Promise.all(['a', 'b'].map((threadId, index) => streaming.stream({ id: index + 1, send: vi.fn() }, {
      threadId, providerType: 'openai', model: 'test-model', messages: [], tools: [toolName],
    })));
    expect(results.every(result => result.success)).toBe(true);
    expect(seen.map(item => [item.before, item.after]).sort()).toEqual([['a', 'a'], ['b', 'b']]);
    expect(new Set(seen.map(item => item.runId)).size).toBe(2);
  });

  it('ends autonomous work on a natural model stop without spending another call', async () => {
    const faux = new FauxModelProvider([fauxText('done'), fauxText('must not run')]);
    const { run } = setupLoop(faux);
    expect(await run()).toMatchObject({ success: true, text: 'done' });
    expect(faux.remaining).toBe(1);
  });

  it('resumes an autonomous handoff with its summary and next task', async () => {
    defaultToolRegistry.register(new HandoffTool());
    const faux = new FauxModelProvider([
      fauxToolCall('handoff', { summary: 'Found the defect', next_steps: 'Fix it', reason: 'context_limit' }),
      fauxText('fixed'),
    ]);
    const call = vi.spyOn(faux, 'doStream');
    const { run } = setupLoop(faux, ['handoff']);
    try {
      expect(await run()).toMatchObject({ success: true });
      expect(call).toHaveBeenCalledTimes(2);
      const prompt = JSON.stringify(call.mock.calls[1][0].prompt);
      expect(prompt).toContain('Found the defect');
      expect(prompt).toContain('Fix it');
    } finally { defaultToolRegistry.remove('handoff'); }
  });

  it('respects the autonomous batch limit after SDK step exhaustion', async () => {
    defaultToolRegistry.register(createTool({
      name: toolName, type: 'function', description: 'Probe',
      paramSchema: z.object({}), handler: async () => 'observation',
    }));
    const faux = new FauxModelProvider([
      fauxToolCall(toolName, {}), fauxToolCall(toolName, {}), fauxText('must not run'),
    ]);
    const { run } = setupLoop(faux, [toolName]);
    expect(await run(1, 2)).toMatchObject({ success: true });
    expect(faux.remaining).toBe(1);
    const completedUpdate = vi.mocked(agentRunDb.appendAgentRunStepAndUpdateRun).mock.calls
      .map(([, updates]) => updates)
      .filter(updates => updates.status === 'completed')
      .at(-1);
    expect(completedUpdate?.output).toMatchObject({
      finishReason: 'budget-exhausted',
    });
  });

  it('preserves observations and the latest human feedback during steering', async () => {
    defaultToolRegistry.register(createTool({
      name: toolName, type: 'function', description: 'Probe',
      paramSchema: z.object({}), handler: async () => 'completed observation',
    }));
    const faux = new FauxModelProvider([
      fauxToolCall(toolName, {}), fauxText('interrupted'), fauxText('steered response'),
    ]);
    const { coordinator, run } = setupLoop(faux, [toolName]);
    const original = faux.doStream.bind(faux);
    let calls = 0;
    const call = vi.spyOn(faux, 'doStream').mockImplementation(options => {
      if (++calls === 2) expect(coordinator.steerStream(42, 'thread_1', 'new direction').success).toBe(true);
      return original(options);
    });
    expect(await run()).toMatchObject({ success: true, text: 'steered response' });
    const prompt = JSON.stringify(call.mock.calls[2][0].prompt);
    expect(prompt).toContain('completed observation');
    expect(prompt.match(/original task/g)).toHaveLength(1);
    expect(JSON.stringify(call.mock.calls[2][0].prompt.at(-1))).toContain('new direction');
  });

});
