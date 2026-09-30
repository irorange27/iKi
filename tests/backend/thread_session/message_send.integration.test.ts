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
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const toolName = 'message_send_context_probe';

describe('createMessageSend integration', () => {
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
    const recordedSteps = vi.mocked(agentRunDb.appendAgentRunStepAndUpdateRun).mock.calls
      .map(([step]) => step);
    expect(recordedSteps.some(step => step.type === 'tool-call' && !step.input?.toolCallId)).toBe(false);
    expect(
      recordedSteps.some(step =>
        step.type === 'model' &&
        step.output?.inference === true &&
        Array.isArray(step.output.content) &&
        step.output.content.some(part =>
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          part.type === 'tool-call' &&
          'toolCallId' in part
        )
      )
    ).toBe(true);
    expect(
      recordedSteps.some(step =>
        step.type === 'model' &&
        step.output?.inference === true &&
        Array.isArray(step.output.content) &&
        step.output.content.some(part =>
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          part.type === 'tool-result'
        )
      )
    ).toBe(true);
  });
});
