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
  createAgentRun: vi.fn((run: Record<string, unknown>) => ({
    ...run,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  })),
  createAgentRunCheckpoint: vi.fn(),
  getAgentRun: vi.fn(() => null),
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
      report: { totalEstimatedTokens: 1 },
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

    const streaming = createChatStreaming({
      streamCoordinator,
      memory: {} as never,
      usage,
      approvals,
      getThreadTitle: () => 'Thread',
    });

    const result = await streaming.stream(target, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'gpt-4o-mini',
      threadId: 'thread_1',
      messages: [{ role: 'user', content: 'run stream probe' }],
      tools: [toolName],
      maxIterations: 10,
    });

    if (!result.success) throw new Error(result.error);
    expect(result).toMatchObject({ success: true, text: 'stream done', stopped: false });
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
    expect(usage.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'chat.stream',
      threadId: 'thread_1',
      providerType: 'openai',
      model: 'gpt-4o-mini',
    }));
    expect(approvals.cleanupPendingSessionsForSender).toHaveBeenCalledWith(42);
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
  });
  const setupLoop = (faux: FauxModelProvider, toolNames: string[] = []) => {
    createModelMock.mockReturnValue(faux);
    prepareChatTurnMock.mockResolvedValue({
      report: { totalEstimatedTokens: 1 }, usedSkills: [], selectedSkillIds: [], skillMode: 'manual',
      finalMessages: [{ role: 'user', content: 'original task' }], history: [], prompt: 'original task',
      guardActive: false, requireApproval: false, autoApproveToolRequests: false,
      affectSignal: null, interventionPolicy: null, guardedTools: toolNames, enableTools: toolNames.length > 0,
    });
    const coordinator = createThreadStreamCoordinator();
    const streaming = createChatStreaming({
      streamCoordinator: coordinator, memory: {} as never,
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
    return { coordinator, run };
  };

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
