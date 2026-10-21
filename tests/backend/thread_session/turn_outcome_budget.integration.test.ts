// @vitest-environment node

/**
 * One outcome authority + two explicit budgets (the 2026-10 audit, A-1/A-2/C-1;
 * user's rule: "LLM is stateless, so any state needs exactly one source").
 *
 * DISCRIMINATING REGRESSION (written BEFORE the fix, confirmed red on the old
 * code): a NON-autonomous turn whose step budget runs out on a step that asked
 * for a tool. The old driver only translated `continuing` into
 * `budget-exhausted` inside the autonomous branch, so this turn fell through
 * to the shared finalize's `else` arm and was recorded as a plain success:
 *
 *   old code → run row `status:'completed'`, `finishReason:'completed'`,
 *              session-log terminal `turn_completed` with NO finishReason
 *   new code → run row `status:'completed'`, `finishReason:'budget-exhausted'`,
 *              session-log terminal `turn_completed` with
 *              `finishReason:'budget-exhausted'`
 *
 * The second face of the same defect is the dropped remainder: the loop
 * reports the calls it could not consume, and before the fix `TurnOutput`
 * had no field for them, so "half an answer" vanished at the harness seam.
 * The test also pins the projection PARITY the two-switch split broke
 * (A-2): the run row and the session-log terminal fact must agree on
 * `finishReason` and text for the same outcome.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const callPiChatMock = vi.hoisted(() => vi.fn());

// Supply seam: Pi is the only executor (ADR 009); scripting it keeps the suite
// on the durable contract without a network endpoint.
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

vi.mock('@iki/backend/db/thread_todos', () => ({
  writeThreadTodoPlan: vi.fn(),
}));

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

/** A step that asks for the probe tool, then (if it ever ran) a final text. */
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

/** The terminal fact the session log recorded for one run. */
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
    // Fresh database per test: the durable layer under test is the DB itself,
    // so reusing one file would let one case's rows seed the next.
    initializeDatabase({ dbPath: path.join(root, `outcome-${testIndex++}.db`) });
    setTurnHarnessFallback(piTurnHarness);
    seedTurnProvider({ providerId: 'provider_outcome', model: 'outcome-model' });
    addWorkspace({ id: 'ws_outcome', path: root, name: 'outcome' });
    // Register the probe. It declares no approval mode of its own: this suite
    // is about the BUDGET, and a tool that asks for approval would pause the
    // turn before its step budget could ever be reached. Registered before any
    // turn resolves tools so nothing else wraps it first.
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
      // The STEP budget, on the ENTRY contract. `budget` is the plan's
      // internal shape; a caller still names the step bound `maxIterations`
      // and the batch bound `autonomous` — assembly is what distinguishes them
      // into `plan.budget.{step,batch}`. Passing the plan shape here silently
      // took the default (200), so the step budget never ran out and the turn
      // finalized as a plain success.
      maxIterations: 1,
      messages: [{ id: 'msg_budget_stream', role: 'user', content: 'probe once' }],
      tools: [PROBE],
    });
    expect(result).toMatchObject({ success: true });

    const runs = listAgentRunsByThread(threadId);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;

    // ── run row projection ────────────────────────────────────────────
    // Old code: finishReason 'completed' (the silent success this fixes).
    expect(run.status).toBe('completed');
    expect((run.output as { finishReason?: string } | null)?.finishReason).toBe(
      'budget-exhausted'
    );

    // ── session-log projection, produced by the SAME table ────────────
    const terminal = terminalFactFor(threadId, run.id);
    expect(terminal?.type).toBe('turn_completed');
    const payload = terminal!.payload as { status: string; finishReason?: string };
    expect(payload.finishReason).toBe('budget-exhausted');
    // Parity (A-2): one outcome, one finishReason in both projections.
    expect(payload.finishReason).toBe(
      (run.output as { finishReason?: string } | null)?.finishReason
    );

    // The remainder the harness could not consume is carried, not dropped:
    // `pendingToolCalls` rides the run row's output, so "half an answer" is
    // visible to whoever reads the row instead of vanishing at the seam.
    // The wire shape is the loop's own call shape (`id`/`name`/`arguments`);
    // the assertion reads `name`, which is what the harness projects.
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
    // The two budgets are independent: the step budget ENDS the batch, the
    // batch bound decides whether another batch follows. With a batch bound
    // of 2 and a step budget of 1, the second batch reaches its own final
    // answer — no budget-exhausted leaks out of a turn the batch bound
    // finished.
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
