// @vitest-environment node

/**
 * EXPERIMENT: what would it cost to make `chat_messages` a pure projection?
 *
 * ADR 008 demoted `chat_messages` to "a rebuildable projection", but nothing
 * acts on that: the rows are still written on every turn and read on every
 * render. Making them derived instead would delete the table, its writer, and
 * `db/chat_message.ts` — but only if replaying the event stream is cheap
 * enough to serve a render, or cheap enough that a cache would pay for itself.
 *
 * This file measures the numbers that decide it, and asserts nothing about
 * performance (a timing assertion in CI is a flaky test). It exists so the
 * decision is made on measurements rather than on the word "projection".
 *
 * What it answers:
 *  1. How many events does a conversation accumulate per turn, and how much of
 *     that is the `model_output_committed` payload? (The committed message
 *     rides EVERY batch, so this is the growth driver.)
 *  2. How long does one full replay take, and how does it scale with history?
 *  3. How does that compare to the row read it would replace?
 *  4. Is the cost dominated by SQLite, by JSON.parse, or by the fold itself?
 *
 * Run with: ./node_modules/.bin/vitest run tests/backend/thread_session/replay_cost.bench.test.ts
 * The measured table is printed to stdout; read it, do not assert on it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { getDb } from '@iki/backend/db/database';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { getChatMessages } from '@iki/backend/db/chat_message';
import { addChatMessage } from '@iki/backend/db/chat_message';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  MODEL_TEXT_COMMITTED,
  SESSION_EVENT_VERSION,
  TURN_COMPLETED,
  TURN_STARTED,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
} from '@iki/backend/thread_session/session_log';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';

const created: string[] = [];

const freshDb = (label: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `replay-cost-${label}-`));
  created.push(dir);
  return path.join(dir, 'cost.db');
};

/** A realistic assistant message: prose plus a tool part, which is what a
 *  turn that used a tool actually commits. */
const assistantMessage = (runId: string, index: number): ChatUiMessage => ({
  id: `assistant_${runId}_${index}`,
  role: 'assistant',
  parts: [
    {
      type: 'text',
      text: `Answer for step ${index}. `.repeat(40),
    },
    {
      type: 'dynamic-tool',
      toolCallId: `call_${runId}_${index}`,
      toolName: 'read_file',
      state: 'output-available',
      input: { path: `/tmp/file_${index}.ts` },
      output: { content: 'x'.repeat(2000) },
    },
  ],
} as unknown as ChatUiMessage);

const userMessage = (threadId: string, index: number): ChatUiMessage => ({
  id: `user_${threadId}_${index}`,
  role: 'user',
  parts: [{ type: 'text', text: `Request number ${index}. `.repeat(20) }],
} as unknown as ChatUiMessage);

/**
 * Seed one conversation with `turns` completed turns, writing BOTH stores in
 * the shape production actually produces.
 *
 * CORRECTION: an earlier version of this file seeded one
 * MODEL_OUTPUT_COMMITTED per batch, which made the committed payload look like
 * 91% of the log. That is wrong — `finalizeTurn` runs ONCE per turn (the batch
 * loop breaks on a terminal outcome before it), so a turn writes exactly one
 * full-message snapshot. What IS per-flush is MODEL_TEXT_COMMITTED, which
 * carries only the incremental text (`seq` + `text`), not a message.
 *
 * `flushesPerTurn` therefore models the real per-turn event count: several
 * small text chunks plus one message snapshot.
 */
const seedConversation = (threadId: string, turns: number, flushesPerTurn: number) => {
  getDb()
    .prepare(
      `INSERT INTO chat_threads (id, title, metadata, created_at, updated_at)
       VALUES (?, ?, '{}', ?, ?)`
    )
    .run(threadId, threadId, new Date().toISOString(), new Date().toISOString());

  for (let turn = 0; turn < turns; turn += 1) {
    const runId = `run_${threadId}_${turn}`;
    const input = userMessage(threadId, turn);
    recordSessionEvents(threadId, [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: { message: input, system: ['persona'] },
      },
      {
        type: TURN_STARTED,
        version: SESSION_EVENT_VERSION,
        payload: { runId, kind: 'chat-turn', plan: { providerType: 'openai', model: 'm' } },
      },
    ]);
    addChatMessage({
      id: input.id,
      thread_id: threadId,
      message: JSON.stringify(input),
      timestamp: new Date().toISOString(),
      metadata: '{}',
    });

    // Per flush: an incremental text chunk (small, additive).
    const message = assistantMessage(runId, 0);
    for (let flush = 0; flush < flushesPerTurn; flush += 1) {
      recordSessionEvents(threadId, [
        {
          type: MODEL_TEXT_COMMITTED,
          version: SESSION_EVENT_VERSION,
          payload: {
            runId,
            messageId: message.id,
            seq: flush,
            text: `streamed text chunk number ${flush} `.repeat(4),
          },
        },
      ]);
    }
    // Per turn: ONE full-message snapshot, written by finalizeTurn.
    recordSessionEvents(threadId, [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: { runId, messageId: message.id, message, transport: 'stream' },
      },
    ]);
    addChatMessage({
      id: message.id,
      thread_id: threadId,
      message: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      metadata: '{}',
    });

    recordSessionEvents(threadId, [
      {
        type: TURN_COMPLETED,
        version: SESSION_EVENT_VERSION,
        payload: { runId, status: 'completed' },
      },
    ]);
  }
};

/** Median of `runs` timings, in milliseconds. Median rather than mean because
 *  one GC pause should not move the answer. */
const medianMs = (fn: () => void, runs = 15): number => {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
};

const eventCount = (threadId: string): number => {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM session_events WHERE thread_id = ?')
    .get(threadId) as { c: number };
  return row.c;
};

const eventBytes = (threadId: string): number => {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(LENGTH(payload)), 0) AS b FROM session_events WHERE thread_id = ?')
    .get(threadId) as { b: number };
  return row.b;
};

const committedShare = (threadId: string): { count: number; bytes: number } => {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(payload)), 0) AS b
       FROM session_events WHERE thread_id = ? AND type = ?`
    )
    .get(threadId, MODEL_OUTPUT_COMMITTED) as { c: number; b: number };
  return { count: row.c, bytes: row.b };
};

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const ms = (value: number): string => `${value.toFixed(3)} ms`;

describe('replay cost: what making chat_messages a projection would cost', () => {
  let dataDir = '';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-cost-db-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'cost.db') });
  });

  afterAll(() => {
    closeDatabase();
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('measures growth per turn and replay cost across conversation lengths', () => {
    const results: Array<{
      turns: number;
      events: number;
      bytes: number;
      committedCount: number;
      committedBytes: number;
      replayMs: number;
      rowsMs: number;
    }> = [];

    for (const turns of [10, 50, 100, 300, 600]) {
      const threadId = `thread_${turns}`;
      // 4 flushes per turn is a turn whose text crossed a few flush points
      // (tool boundary, interval, end) before the single finalize snapshot.
      seedConversation(threadId, turns, 4);

      // Warm the page cache so the comparison is not measuring first-touch.
      rebuildThreadViewFromEvents(threadId);
      getChatMessages(threadId);

      const replayMs = medianMs(() => {
        rebuildThreadViewFromEvents(threadId);
      });
      const rowsMs = medianMs(() => {
        getChatMessages(threadId);
      });
      const committed = committedShare(threadId);

      results.push({
        turns,
        events: eventCount(threadId),
        bytes: eventBytes(threadId),
        committedCount: committed.count,
        committedBytes: committed.bytes,
        replayMs,
        rowsMs,
      });
    }

    // eslint-disable-next-line no-console
    console.log('\n=== replay cost (4 flushes + 1 snapshot per turn) ===');
    // eslint-disable-next-line no-console
    console.log(
      'turns  events  log size   committed   replay      rows        rows/replay'
    );
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `${String(r.turns).padStart(5)}  ${String(r.events).padStart(6)}  ${kb(r.bytes).padStart(9)}  ${`${r.committedCount} (${kb(r.committedBytes)})`.padStart(16)}  ${ms(r.replayMs).padStart(10)}  ${ms(r.rowsMs).padStart(10)}  ${(r.replayMs / r.rowsMs).toFixed(1)}x`
      );
    }

    // Sanity, not performance: the seed must have produced a conversation that
    // replay actually folds, or the timings above measure nothing.
    const longest = results.at(-1)!;
    const view = rebuildThreadViewFromEvents(`thread_${longest.turns}`);
    expect(view.messages.length).toBeGreaterThan(0);
    expect(view.turns.length).toBe(longest.turns);
    expect(longest.events).toBeGreaterThan(longest.turns * 3);
  }, 120_000);

  it('separates the cost: SQLite read vs JSON.parse vs the fold', () => {
    const threadId = 'thread_600';

    // Total: read + parse + fold.
    const total = medianMs(() => {
      rebuildThreadViewFromEvents(threadId);
    });

    // Read + parse only (getSessionEvents returns parsed payloads).
    const readParse = medianMs(() => {
      getSessionEvents(threadId);
    });

    // Raw SQL only: no JSON.parse, no fold.
    const rawRead = medianMs(() => {
      getDb()
        .prepare(
          'SELECT revision, type, version, payload, created_at FROM session_events WHERE thread_id = ? ORDER BY revision ASC'
        )
        .all(threadId);
    });

    const foldOnly = total - readParse;
    const parseOnly = readParse - rawRead;

    // eslint-disable-next-line no-console
    console.log('\n=== cost breakdown at 600 turns ===');
    // eslint-disable-next-line no-console
    console.log(`  raw SQL read   ${ms(rawRead).padStart(10)}`);
    // eslint-disable-next-line no-console
    console.log(`  + JSON.parse   ${ms(parseOnly).padStart(10)}`);
    // eslint-disable-next-line no-console
    console.log(`  + fold         ${ms(foldOnly).padStart(10)}`);
    // eslint-disable-next-line no-console
    console.log(`  = total replay ${ms(total).padStart(10)}`);
    // eslint-disable-next-line no-console
    console.log(
      `  share: sql ${((rawRead / total) * 100).toFixed(0)}%  parse ${((parseOnly / total) * 100).toFixed(0)}%  fold ${((foldOnly / total) * 100).toFixed(0)}%`
    );

    expect(total).toBeGreaterThan(0);
  }, 120_000);

  it('measures the cache payoff: replay vs an incremental tail', () => {
    // The question a cache design has to answer: after N turns, does reading
    // the tail beat replaying everything? A cache keyed on the last replayed
    // revision would pay a full replay once and then only fold new events, so
    // the interesting number is what fraction of the log is "new".
    const threadId = 'thread_600';
    const all = eventCount(threadId);
    const row = getDb()
      .prepare('SELECT MAX(revision) AS maxRev FROM session_events WHERE thread_id = ?')
      .get(threadId) as { maxRev: number };

    // A render after one more turn would need to fold the events after the
    // cached revision. 5 events/turn is the steady-state rate here.
    const tailAfterOneTurn = 5;
    const tailCost = medianMs(() => {
      getDb()
        .prepare(
          'SELECT revision, type, version, payload, created_at FROM session_events WHERE thread_id = ? AND revision > ? ORDER BY revision ASC'
        )
        .all(threadId, row.maxRev - tailAfterOneTurn);
    });

    const fullCost = medianMs(() => {
      getDb()
        .prepare(
          'SELECT revision, type, version, payload, created_at FROM session_events WHERE thread_id = ? ORDER BY revision ASC'
        )
        .all(threadId);
    });

    // eslint-disable-next-line no-console
    console.log('\n=== cache payoff at 600 turns ===');
    // eslint-disable-next-line no-console
    console.log(`  full log read   ${ms(fullCost).padStart(10)}  (${all} events)`);
    // eslint-disable-next-line no-console
    console.log(
      `  one-turn tail   ${ms(tailCost).padStart(10)}  (${tailAfterOneTurn} events, ${((tailCost / fullCost) * 100).toFixed(1)}% of full)`
    );

    expect(tailCost).toBeLessThanOrEqual(fullCost);
  }, 120_000);
});
