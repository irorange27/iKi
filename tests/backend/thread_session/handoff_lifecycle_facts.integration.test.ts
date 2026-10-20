// @vitest-environment node

/**
 * A handoff chain swaps the executing run mid-turn. The run ROW follows the
 * swap (the parent is marked `completed`, a child row is created), but the
 * session log never heard about it: the parent's `turn_started` has no
 * matching terminal fact and the child has no `turn_started` at all.
 *
 * The replay reducer tolerates the silence by inventing defaults — a
 * terminal-only fact materializes a turn with `kind: 'chat-turn'`, and a
 * started-less turn reads as `running` — so the two projections of one turn
 * disagree: the run list shows both runs `completed` while the replay shows
 * the parent still running and the child mislabeled. A `turn_cancelled`
 * written for a run whose child chain was never started would likewise
 * invent a turn.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: createModelMock,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // These suites verify DURABLE behaviour (effect-aware retry, cancel routing,
  // handoff facts, inline journaling) using a scripted AI SDK model. They are
  // not about supply routing, so they pin the AI SDK harness explicitly: Pi
  // claims every provider type now, and a stubbed `createModel` would never be
  // reached. Routing itself is covered by factory_pi_generation.test.ts and
  // turn_supply_selection.test.ts.
  supportsPiTurnSupply: () => false,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import { legacyTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { rebuildThreadViewFromEvents } from '@iki/backend/thread_session/session_log';

const HANDOFF = 'handoff';

describe('a handoff chain records the run segment swap in the session log', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 41, send: vi.fn() };

  beforeEach(async () => {
  // These suites drive the DURABLE layer (streaming, approvals, session-log
  // facts, retry, persistence) with a scripted AI SDK model. They are not about
  // which supply serves the turn, so they opt into the legacy executor: the
  // production default refuses a turn its projection cannot carry, and a
  // scripted model has no endpoint to project to.
  setTurnHarnessFallback(legacyTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-handoff-facts-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'handoff.db') });
    addProvider({
      id: 'provider_handoff',
      name: 'handoff',
      type: 'openai',
      api_key: 'key-handoff',
      models: '["handoff-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    addWorkspace({ id: 'ws_handoff', path: root, name: 'handoff' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_handoff', workspace_id: 'ws_handoff' });
    defaultToolRegistry.register(
      createTool({
        name: HANDOFF,
        type: 'function',
        description: 'hand the task over',
        paramSchema: z.object({
          summary: z.string(),
          next_steps: z.string(),
          reason: z.string().optional(),
        }),
        handler: async args => args,
      })
    );
  });

  afterEach(async () => {
    defaultToolRegistry.remove(HANDOFF);
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('records the parent segment terminal and the child segment start', async () => {
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall(HANDOFF, {
          summary: 'phase one done',
          next_steps: 'finish phase two',
          reason: 'context_limit',
        }),
        fauxText('phase two complete'),
      ])
    );

    const result = await service.stream(
      target,
      {
        providerType: 'openai',
        providerId: 'provider_handoff',
        model: 'handoff-model',
        threadId: 'thread_handoff',
        approvalPolicy: 'never',
        autonomous: { maxIterations: 3, continuePrompt: 'continue' },
        messages: [{ id: 'msg_handoff', role: 'user', parts: [{ type: 'text', text: 'pass the baton' }] }],
        tools: [HANDOFF],
      }
    );
    expect(result).toMatchObject({ success: true });

    const rows = agentRunDb.listAgentRunsByThread('thread_handoff');
    const parent = rows.find(run => run.kind === 'chat-turn')!;
    const child = rows.find(run => run.kind === 'handoff-resume')!;
    expect(parent.status).toBe('completed');
    expect(child.status).toBe('completed');

    const replay = rebuildThreadViewFromEvents('thread_handoff');
    const parentTurn = replay.turns.find(turn => turn.runId === parent.id);
    const childTurn = replay.turns.find(turn => turn.runId === child.id);

    // The parent segment is terminal in the replay, not still running.
    expect(parentTurn?.status).toBe('completed');
    // The chained segment is known to the replay, and with the kind the run
    // row carries — not the reducer's default.
    expect(childTurn).toBeDefined();
    expect(childTurn?.kind).toBe('handoff-resume');
    expect(childTurn?.status).toBe('completed');

    // Exactly one terminal fact per segment. The driver records the parent's
    // and the entry records the child's, so a second write for either would
    // mean one projection being told the outcome twice.
    const terminalEvents = getSessionEvents('thread_handoff', [
      'turn_completed',
      'turn_failed',
      'turn_cancelled',
    ]);
    const terminalRunIds = terminalEvents.map(
      event => (event.payload as { runId?: string }).runId
    );
    expect(terminalRunIds.filter(runId => runId === parent.id)).toHaveLength(1);
    expect(terminalRunIds.filter(runId => runId === child.id)).toHaveLength(1);
  });
  it('loses the child segment cleanly when its start write fails', async () => {
    // The parent's terminal is recorded BEFORE the chained segment's row
    // exists, so a failure at the segment boundary cannot leave a parent whose
    // log says completed while its row says failed. What it CAN leave — the
    // residual tracked against the tracker's id contract — is the abandoned
    // child row with a `turn_failed` and no `turn_started`; this test pins the
    // reachable half (the parent) and asserts the residual's shape explicitly.
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall(HANDOFF, {
          summary: 'phase one done',
          next_steps: 'finish phase two',
          reason: 'context_limit',
        }),
        fauxText('phase two complete'),
      ])
    );

    const { getDb } = await import('@iki/backend/db/database');
    getDb().exec(`CREATE TRIGGER handoff_swap_reject_started BEFORE INSERT ON session_events
      WHEN NEW.type = 'turn_started' AND json_extract(NEW.payload, '$.kind') = 'handoff-resume'
      BEGIN SELECT RAISE(ABORT, 'handoff swap: started write rejected'); END`);
    try {
      await service.stream(
        target,
        {
          providerType: 'openai',
          providerId: 'provider_handoff',
          model: 'handoff-model',
          threadId: 'thread_handoff',
          approvalPolicy: 'never',
          autonomous: { maxIterations: 3, continuePrompt: 'continue' },
          messages: [{ id: 'msg_handoff_fail', role: 'user', parts: [{ type: 'text', text: 'pass the baton' }] }],
          tools: [HANDOFF],
        }
      );
    } finally {
      getDb().exec('DROP TRIGGER IF EXISTS handoff_swap_reject_started');
    }

    const rows = agentRunDb.listAgentRunsByThread('thread_handoff');
    const replay = rebuildThreadViewFromEvents('thread_handoff');

    // The PARENT never disagrees: its log state matches its row state.
    const parentRow = rows.find(run => run.kind === 'chat-turn')!;
    const parentTurn = replay.turns.find(turn => turn.runId === parentRow.id)!;
    expect(parentTurn).toBeDefined();
    const parentTerminal = parentTurn.status !== 'running';
    expect(parentTerminal).toBe(
      ['completed', 'failed', 'cancelled'].includes(parentRow.status)
    );

    // The residual, stated not hidden: the abandoned child may carry a terminal
    // fact its start never preceded. That is the child-side half of S1 and is
    // blocked on the tracker minting a caller-supplied id — the write ordering
    // alone cannot close it.
    const startedRunIds = new Set(
      getSessionEvents('thread_handoff', ['turn_started']).map(
        event => (event.payload as { runId?: string }).runId,
      )
    );
    const orphanTerminals = replay.turns.filter(
      turn => turn.status !== 'running' && !startedRunIds.has(turn.runId)
    );
    // The residual is bounded: at most the abandoned chained segment, terminal
    // as `failed`, and never the parent.
    for (const turn of orphanTerminals) {
      const row = rows.find(run => run.id === turn.runId)!;
      expect(row.kind).toBe('handoff-resume');
      expect(turn.status).toBe('failed');
    }
    expect(orphanTerminals.length).toBeLessThanOrEqual(1);
  });
});
