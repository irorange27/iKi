// @vitest-environment node
/**
 * The session log is an append-only file per thread. This pins the contract that
 * the rest of the app depends on: ordering, type/payload filters, optimistic
 * concurrency, thread isolation, resume-by-id, whole-file replay, torn-tail repair
 * and atomic batches.
 *
 * Mirrors pi: its interactive CLI stores one JSONL per session and loads it whole
 * (coding-agent/src/core/session-manager.ts), and pi-durable ships JsonlStorage
 * against the same Storage contract as a SQL backend.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createJsonlSessionLogStore,
  type SessionLogStore,
} from '@iki/backend/db/session_log_store';

const event = (type: string, payload: unknown) => ({ type, version: 1, payload });

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

let root = '';
let store: SessionLogStore;

const sessions = () => path.join(root, 'sessions');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-jsonl-'));
  store = createJsonlSessionLogStore(sessions());
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('JSONL session log', () => {
  it('appends in revision order and reads the whole thread back', () => {
    expect(
      store.append('thread_a', 0, [
        event('input_accepted', { messageId: 'msg_1' }),
        event('turn_started', { runId: 'run_1' }),
      ])
    ).toBe(2);
    expect(store.append('thread_a', 2, [event('model_output_committed', { messageId: 'msg_2' })])).toBe(3);
    expect(store.headRevision('thread_a')).toBe(3);
    expect(store.readThread('thread_a').map(e => [e.revision, e.type])).toEqual([
      [1, 'input_accepted'],
      [2, 'turn_started'],
      [3, 'model_output_committed'],
    ]);
  });

  it('filters by type and by payload path', () => {
    store.append('thread_a', 0, [
      event('input_accepted', { messageId: 'msg_1' }),
      event('turn_started', { runId: 'run_1' }),
    ]);
    expect(store.readThread('thread_a', ['turn_started'])).toHaveLength(1);
    expect(store.readThread('thread_a', undefined, { path: '$.runId', value: 'run_1' })).toHaveLength(1);
    expect(store.readThread('thread_a', undefined, { path: '$.runId', value: 'nope' })).toHaveLength(0);
  });

  it('rejects a stale-revision append and leaves the log untouched', () => {
    store.append('thread_a', 0, [event('input_accepted', { messageId: 'm1' })]);
    expect(store.append('thread_a', 0, [event('turn_started', { runId: 'r' })])).toBeNull();
    expect(store.headRevision('thread_a')).toBe(1);
  });

  it('isolates threads and deletes one without touching the other', () => {
    store.append('thread_a', 0, [event('input_accepted', { messageId: 'a' })]);
    store.append('thread_b', 0, [event('input_accepted', { messageId: 'b' })]);
    expect(store.readThread('thread_b')).toHaveLength(1);
    store.deleteThread('thread_b');
    expect(store.readThread('thread_b')).toHaveLength(0);
    expect(store.readThread('thread_a')).toHaveLength(1);
  });

  it('resumes by message id, scoped and across threads, taking the newest', () => {
    store.append('thread_a', 0, [event('input_accepted', { messageId: 'msg_2' })]);
    store.append('thread_a', 1, [event('model_output_committed', { messageId: 'msg_2', text: 'revised' })]);
    store.append('thread_b', 0, [event('input_accepted', { messageId: 'msg_b' })]);
    expect(store.findMessage('msg_2')).toMatchObject({ threadId: 'thread_a' });
    expect(stable(store.findMessage('msg_2'))).toMatchObject({ payload: { text: 'revised' } });
    expect(store.findMessage('msg_b')?.threadId).toBe('thread_b');
    expect(store.findMessage('missing')).toBeNull();
  });

  it('replays after reopening the file alone', () => {
    store.append('thread_a', 0, [event('input_accepted', { messageId: 'm1' })]);
    store.append('thread_a', 1, [event('turn_started', { runId: 'r1' })]);
    const reopened = createJsonlSessionLogStore(sessions());
    expect(stable(reopened.readThread('thread_a'))).toEqual(stable(store.readThread('thread_a')));
    expect(reopened.headRevision('thread_a')).toBe(2);
  });

  it('repairs a torn final line without losing the facts before it', () => {
    store.append('thread_torn', 0, [event('input_accepted', { messageId: 'm' })]);
    fs.appendFileSync(path.join(sessions(), 'thread_torn.jsonl'), '{"kind":"batch","firstRev');
    const reopened = createJsonlSessionLogStore(sessions());
    expect(reopened.readThread('thread_torn')).toHaveLength(1);
    expect(reopened.append('thread_torn', 1, [event('turn_started', { runId: 'r' })])).toBe(2);
    expect(reopened.readThread('thread_torn').map(e => e.revision)).toEqual([1, 2]);
  });

  it('treats one append as one atomic batch, never half a batch', () => {
    store.append('thread_batch', 0, [
      event('input_accepted', { messageId: 'ok' }),
      event('turn_started', { runId: 'r' }),
    ]);
    const torn = JSON.stringify({
      kind: 'batch',
      firstRevision: 3,
      events: [
        { type: 'tool_executed', version: 1, payload: { toolCallId: 'c1' }, createdAt: 't' },
        { type: 'turn_completed', version: 1, payload: { runId: 'r' }, createdAt: 't' },
      ],
    });
    fs.appendFileSync(path.join(sessions(), 'thread_batch.jsonl'), torn.slice(0, 40));
    const reopened = createJsonlSessionLogStore(sessions());
    expect(reopened.readThread('thread_batch')).toHaveLength(2);
    expect(reopened.headRevision('thread_batch')).toBe(2);
  });

  it('refuses a session file from a format version it does not understand', () => {
    fs.writeFileSync(
      path.join(sessions(), 'thread_future.jsonl'),
      `${JSON.stringify({ kind: 'header', version: 999, threadId: 'thread_future' })}\n`
    );
    const reopened = createJsonlSessionLogStore(sessions());
    expect(() => reopened.readThread('thread_future')).toThrow(/Unsupported session log version 999/);
  });
});
