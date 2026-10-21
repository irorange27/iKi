// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const callPiChatMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/thread_session/turn_supply_selection', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/turn_supply_selection')>()),
  pausedPlanRunsOnPiToolSupply: () => true,
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
    getProviderConfig: vi.fn(() => ({
      type: 'openai',
      apiKey: 'key-test',
      baseURL: 'http://127.0.0.1:9/v1',
    })),
  };
});

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { getAgentRun, listAgentRunsByThread } from '@iki/backend/db/agent_runs';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createMessageSend } from '@iki/backend/thread_session/message_send';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import {
  createScriptedPiChat,
  type PiScript,
} from '@iki/backend/agent/testing/scripted_pi';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import { addChatThread } from '@iki/backend/db/chat_thread';

const PROBE = 'outcome_budget_probe';

const TOOL_THEN_TEXT: PiScript = [
  [
    { kind: 'toolCall', toolName: PROBE, args: {}, id: 'call_budget_probe' },
    { kind: 'done', reason: 'toolUse' },
  ],
  [
    { kind: 'text', text: 'must not run' },
    { kind: 'done', reason: 'stop' },
  ],
];

let root: string;
let testIndex = 0;

const terminalFactFor = (threadId: string, runId: string) => {
  const terminalEvents = getSessionEvents(threadId, [
    'turn_completed',
    'turn_failed',
    'turn_cancelled',
  ]);
  return terminalEvents
    .filter(event => (event.payload as { runId?: string }).runId === runId)
    .at(-1);
};

describe('turn outcome: one authority, two explicit budgets', () => {
  beforeEach(async () => {
    if (!root) root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-turn-outcome-'));
    initializeDatabase({ dbPath: path.join(root, `outcome-${testIndex++}.db`) });
    setTurnHarnessFallback(piTurnHarness);
    seedTurnProvider({ providerId: 'provider_outcome', model: 'outcome-model' });
    addWorkspace({ id: 'ws_outcome', path: root, name: 'outcome' });
    defaultToolRegistry.register(
      createTool({
        name: PROBE,
        type: 'function',
        description: 'Probe the tool path',
        paramSchema: z.object({}),
        handler: async () => 'completed observation',
      })
    );
    vi.clearAllMocks();
    callPiChatMock.mockImplementation(createScriptedPiChat(TOOL_THEN_TEXT));
  });

  afterEach(async () => {
    defaultToolRegistry.remove(PROBE);
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
  });

  const streaming = () =>
    createChatStreaming({
      streamCoordinator: createThreadStreamCoordinator(),
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

  const seedThread = (threadId: string) =>
    addChatThread({ id: threadId, title: threadId, metadata: '{}', workspace_id: 'ws_outcome' });

  it('records a non-autonomous step-budget exhaustion as budget-exhausted in BOTH projections', async () => {
    const threadId = 'thread_outcome_stream';
    seedThread(threadId);
    const target = { id: 71, send: vi.fn() };

    const result = await streaming().stream(target, {
      providerType: 'openai',
      providerId: 'provider_outcome',
      model: 'outcome-model',
      threadId,
      maxIterations: 1,
      messages: [{ id: 'msg_budget_stream', role: 'user', content: 'probe once' }],
      tools: [PROBE],
    });
    expect(result).toMatchObject({ success: true });

    const runs = listAgentRunsByThread(threadId);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;

    expect(run.status).toBe('completed');
    expect((run.output as { finishReason?: string } | null)?.finishReason).toBe(
      'budget-exhausted'
    );

    const terminal = terminalFactFor(threadId, run.id);
    expect(terminal?.type).toBe('turn_completed');
    const payload = terminal!.payload as { status: string; finishReason?: string };
    expect(payload.finishReason).toBe('budget-exhausted');
    expect(payload.finishReason).toBe(
      (run.output as { finishReason?: string } | null)?.finishReason
    );

    const output = run.output as { pendingToolCalls?: Array<{ name: string }> } | null;
    expect(output?.pendingToolCalls?.map(call => call.name)).toEqual([PROBE]);
  });

  it('records a non-autonomous step-budget exhaustion the same way when the transport is send', async () => {
    const threadId = 'thread_outcome_send';
    seedThread(threadId);
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
          finalMessages: [{ role: 'user' as const, content: 'probe once' }],
          history: [],
          prompt: 'probe once',
          guardActive: false,
          requireApproval: false,
          autoApproveToolRequests: false,
          affectSignal: null,
          interventionPolicy: null,
          guardedTools: [PROBE],
          enableTools: true,
        })),
      } as never,
    }).send;

    const result = await send({
      providerType: 'openai',
      providerId: 'provider_outcome',
      model: 'outcome-model',
      threadId,
      maxIterations: 1,
      messages: [{ id: 'msg_budget_send', role: 'user', content: 'probe once' }],
      tools: [PROBE],
    });
    expect(result).toMatchObject({ success: true });

    const runs = listAgentRunsByThread(threadId);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.status).toBe('completed');
    expect((run.output as { finishReason?: string } | null)?.finishReason).toBe(
      'budget-exhausted'
    );
    const payload = terminalFactFor(threadId, run.id)?.payload as
      | { status: string; finishReason?: string }
      | undefined;
    expect(payload?.finishReason).toBe('budget-exhausted');
  });

  it('lets the batch bound continue a turn whose step budget ran out', async () => {
    const threadId = 'thread_outcome_batch';
    seedThread(threadId);
    const target = { id: 72, send: vi.fn() };

    const result = await streaming().stream(target, {
      providerType: 'openai',
      providerId: 'provider_outcome',
      model: 'outcome-model',
      threadId,
      maxIterations: 1,
      autonomous: { maxIterations: 2, continuePrompt: 'keep going' },
      messages: [{ id: 'msg_budget_batch', role: 'user', content: 'probe then answer' }],
      tools: [PROBE],
    });
    expect(result).toMatchObject({ success: true });

    const runs = listAgentRunsByThread(threadId);
    const run = runs.at(-1)!;
    expect(run.status).toBe('completed');
    expect((run.output as { finishReason?: string } | null)?.finishReason).toBe('completed');
    expect(run.id).toBe(getAgentRun(run.id)!.id);
    expect(((run.output as { text?: string } | null)?.text ?? '')).toContain(
      'must not run'
    );
  });
});
