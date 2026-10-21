import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const callPiChatMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/thread_session/turn_supply_selection', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/turn_supply_selection')>()),
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
    getProviderConfig: vi.fn(() => ({
      type: 'openai',
      apiKey: 'key-test',
      baseURL: 'http://127.0.0.1:9/v1',
    })),
    getModelGenerationSettings: vi.fn(() => ({})),
  };
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import { createMessageSend } from '@iki/backend/thread_session/message_send';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const toolName = 'message_send_context_probe';

let dbRoot: string;

describe('createMessageSend integration', () => {
  beforeEach(async () => {
    if (!dbRoot) {
      dbRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-message-send-'));
    }
    initializeDatabase({ dbPath: path.join(dbRoot, 'send.db') });
    seedTurnProvider({ providerId: 'provider_primary', providerType: 'openai', model: 'test-model' });
    setTurnHarnessFallback(piTurnHarness);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    defaultToolRegistry.remove(toolName);
  });

  afterAll(async () => {
    closeDatabase();
    if (dbRoot) await fs.rm(dbRoot, { recursive: true, force: true });
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
    expect(callPiChatMock).toHaveBeenCalled();
    expect((callPiChatMock.mock.calls[0] as unknown[])[0]).toMatchObject({
      id: 'gpt-4o-mini',
    });
    expect(conversation.createMessage).not.toHaveBeenCalled();
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
    const recordedSteps = agentRunDb
      .listAgentRunsByThread('thread_1')
      .flatMap(run => agentRunDb.listAgentRunSteps(run.id));
    expect(recordedSteps.some(step => step.type === 'tool-call' && !step.input?.toolCallId)).toBe(
      false
    );
    const inferenceContents = recordedSteps
      .filter(step => step.type === 'model' && step.output?.inference === true)
      .map(step => (step.output?.content ?? []) as Array<{ type?: string }>);
    expect(inferenceContents.some(parts => parts.some(part => part.type === 'tool-call'))).toBe(
      true
    );
    expect(
      inferenceContents.every(parts => parts.every(part => part.type !== 'tool-result'))
    ).toBe(true);
  });

  it('labels a send that exhausts its tool budget as budget-exhausted, not completed', async () => {
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

    const completedRun = agentRunDb
      .listAgentRunsByThread('thread_budget')
      .filter(run => run.status === 'completed')
      .at(-1);
    expect(completedRun?.output).toMatchObject({ finishReason: 'budget-exhausted' });
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
    expect(conversation.createMessage).not.toHaveBeenCalled();
    expect(conversation.upsertTurnMessage).not.toHaveBeenCalled();
  });
});
