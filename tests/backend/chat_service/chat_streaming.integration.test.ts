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

vi.mock('@iki/backend/agent_session/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: prepareChatTurnMock,
  }),
}));

vi.mock('@iki/backend/chat_service/platform', () => ({
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

import { createChatStreaming } from '@iki/backend/chat_service/streaming';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { getToolRuntimeContext } from '@iki/backend/tools/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

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

    const activeStreams = new Map();
    const usage = { recordUsageEvent: vi.fn() };
    const approvals = {
      ensurePendingApprovalSession: vi.fn(),
      registerApprovalBatch: vi.fn(),
      cleanupPendingSessionsForSender: vi.fn(),
    };
    const target = { id: 42, send: vi.fn() };

    const streaming = createChatStreaming({
      activeStreams,
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
    expect(activeStreams.has(42)).toBe(false);

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
  });
});
