// @vitest-environment node
/**
 * The validation slice for "does the session log need a database?".
 *
 * Both backends are driven through the identical scenario and their observable
 * results must match. Production still uses the SQLite functions; this test is the
 * proof that a per-thread append-only file is a legal substitute, so switching the
 * default later is an injection change rather than a rewrite.
 *
 * Mirrors pi: its interactive CLI stores one JSONL per session and loads it whole
 * (coding-agent/src/core/session-manager.ts), and pi-durable ships JsonlStorage and
 * SqliteStorage against the same Storage contract.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import {
  appendSessionEvents,
  appendSessionFacts,
  deleteSessionEvents,
  findMessageEvent,
  getSessionEventRevision,
  getSessionEvents,
} from '@iki/backend/db/session_events';
import {
  createJsonlSessionLogStore,
  type SessionLogStore,
} from '@iki/backend/db/session_log_store';

/** Wrap the existing SQLite functions in the pluggable contract. */
const sqliteStore = (): SessionLogStore => ({
  append: (threadId, expectedRevision, events) =>
    expectedRevision === null
      ? appendSessionFacts(threadId, events)
      : appendSessionEvents(threadId, expectedRevision, events),
  readThread: getSessionEvents,
  headRevision: getSessionEventRevision,
  deleteThread: deleteSessionEvents,
  findMessage: findMessageEvent,
});

const event = (type: string, payload: unknown) => ({ type, version: 1, payload });

/** Timestamps differ between two independent backends; everything else must match. */
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (key === 'createdAt') continue;
    out[key] = stable(record[key]);
  }
  return out;
};

/**
 * One scenario, run against both stores. Every operation is observable: append
 * result, full stream, filtered reads, head revision, CAS rejection, thread
 * isolation, deletion and resume-by-id.
 */
const runScenario = (store: SessionLogStore) => {
  const results: Record<string, unknown> = {};

  results.firstAppend = store.append('thread_a', 0, [
    event('input_accepted', { messageId: 'msg_1', message: { id: 'msg_1', role: 'user' } }),
    event('turn_started', { runId: 'run_1', kind: 'chat-turn' }),
  ]);
  results.secondAppend = store.append('thread_a', 2, [
    event('model_output_committed', { messageId: 'msg_2', runId: 'run_1' }),
  ]);
  results.headAfterTwo = store.headRevision('thread_a');
  results.fullStream = stable(store.readThread('thread_a'));
  results.byType = stable(store.readThread('thread_a', ['turn_started']));
  results.byPayloadPath = stable(
    store.readThread('thread_a', undefined, { path: '$.runId', value: 'run_1' })
  );
  results.noMatch = stable(
    store.readThread('thread_a', undefined, { path: '$.runId', value: 'missing' })
  );

  // Optimistic concurrency: a writer basing on a stale head must not land.
  results.staleCas = store.append('thread_a', 1, [event('turn_completed', { runId: 'run_1' })]);
  results.headAfterStale = store.headRevision('thread_a');

  // A second thread is fully isolated.
  store.append('thread_b', 0, [
    event('input_accepted', { messageId: 'msg_b', message: { id: 'msg_b', role: 'user' } }),
  ]);
  results.threadB = stable(store.readThread('thread_b'));
  results.threadAUnchanged = stable(store.readThread('thread_a'));

  // Resume by message id, scoped and unscoped (the only cross-thread read).
  results.findScoped = stable(store.findMessage('msg_2', 'thread_a'));
  results.findGlobal = stable(store.findMessage('msg_b'));
  results.findMissing = stable(store.findMessage('nope'));

  // Latest commit wins when the same message id was superseded.
  store.append('thread_a', 3, [
    event('model_output_committed', { messageId: 'msg_2', runId: 'run_1', text: 'revised' }),
  ]);
  results.findAfterSupersede = stable(store.findMessage('msg_2', 'thread_a'));

  store.deleteThread('thread_b');
  results.threadBAfterDelete = stable(store.readThread('thread_b'));
  results.headBAfterDelete = store.headRevision('thread_b');
  results.threadAAfterDelete = stable(store.readThread('thread_a'));

  return results;
};

describe('SessionLogStore: JSONL and SQLite are equivalent', () => {
  let root: string;
  let jsonl: SessionLogStore;
  let sqlite: SessionLogStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-store-equivalence-'));
    initializeDatabase({ dbPath: path.join(root, 'events.db') });
    sqlite = sqliteStore();
    jsonl = createJsonlSessionLogStore(path.join(root, 'sessions'));
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('produces identical observable results for the same scenario', () => {
    const fromSqlite = runScenario(sqlite);
    const fromJsonl = runScenario(jsonl);
    expect(fromJsonl).toEqual(fromSqlite);

    // Guard against a vacuous pass: the scenario really did write events.
    expect(fromSqlite.headAfterTwo).toBe(3);
    expect(fromSqlite.staleCas).toBeNull();
    expect(fromSqlite.headAfterStale).toBe(3);
  });

  it('replays a whole thread from the file alone, like pi SessionManager.open', () => {
    runScenario(jsonl);
    runScenario(sqlite);
    const reopened = createJsonlSessionLogStore(path.join(root, 'sessions'));
    expect(stable(reopened.readThread('thread_a'))).toEqual(stable(sqlite.readThread('thread_a')));
    expect(reopened.headRevision('thread_a')).toBe(sqlite.headRevision('thread_a'));
  });

  it('repairs a torn final line without losing the facts before it', () => {
    jsonl.append('thread_torn', 0, [event('input_accepted', { messageId: 'msg_torn' })]);
    const file = path.join(root, 'sessions', 'thread_torn.jsonl');
    fs.appendFileSync(file, '{"kind":"event","revision":2,"type":"turn_sta');

    const reopened = createJsonlSessionLogStore(path.join(root, 'sessions'));
    expect(reopened.readThread('thread_torn')).toHaveLength(1);
    expect(reopened.headRevision('thread_torn')).toBe(1);

    // A later append continues from the surviving head, never from the half-line.
    expect(reopened.append('thread_torn', 1, [event('turn_started', { runId: 'r' })])).toBe(2);
    expect(reopened.readThread('thread_torn').map(e => e.revision)).toEqual([1, 2]);
  });

  it('treats one append as one atomic batch, never half a batch', () => {
    // SQLite wraps a batch in a transaction. The file backend must match: a torn
    // line discards the whole batch, not the first events of it.
    jsonl.append('thread_batch', 0, [
      event('input_accepted', { messageId: 'msg_ok' }),
      event('turn_started', { runId: 'run_batch' }),
    ]);
    const file = path.join(root, 'sessions', 'thread_batch.jsonl');
    const tornBatch = JSON.stringify({ kind: 'batch', firstRevision: 3, events: [
      { type: 'tool_executed', version: 1, payload: { toolCallId: 'c1' }, createdAt: 't' },
      { type: 'turn_completed', version: 1, payload: { runId: 'run_batch' }, createdAt: 't' },
    ] });
    fs.appendFileSync(file, tornBatch.slice(0, Math.floor(tornBatch.length / 2)));

    const reopened = createJsonlSessionLogStore(path.join(root, 'sessions'));
    expect(reopened.readThread('thread_batch')).toHaveLength(2);
    expect(reopened.headRevision('thread_batch')).toBe(2);
    expect(reopened.readThread('thread_batch').map(e => e.type)).toEqual([
      'input_accepted',
      'turn_started',
    ]);
  });

  it('refuses a session file from a format version it does not understand', () => {
    const file = path.join(root, 'sessions', 'thread_future.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ kind: 'header', version: 999, threadId: 'thread_future' })}\n`);
    const reopened = createJsonlSessionLogStore(path.join(root, 'sessions'));
    expect(() => reopened.readThread('thread_future')).toThrow(/Unsupported session log version 999/);
  });
});
