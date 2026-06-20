import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());
const writeThreadTodoPlanMock = vi.hoisted(() => vi.fn());

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

import { createChatSend } from '@iki/backend/chat_service/chat_send';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { getToolRuntimeContext } from '@iki/backend/tools/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const toolName = 'chat_send_context_probe';

describe('createChatSend integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    defaultToolRegistry.remove(toolName);
  });

  it('runs tool-enabled send through AgentHarness and preserves runtime context', async () => {
    let observedContext: unknown;
    defaultToolRegistry.register(createTool({
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
    }));

    createModelMock.mockReturnValue(new FauxModelProvider([
      fauxToolCall(toolName, {}),
      fauxText('done'),
    ]));

    const send = createChatSend({
      checkThreadRunRate: () => ({ allowed: true }),
      usage: { recordUsageEvent: vi.fn() },
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
      messages: [{ role: 'user', content: 'run probe' }],
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
    expect(createModelMock).toHaveBeenCalledWith('openai', 'gpt-4o-mini', 'provider_primary');
  });
});
