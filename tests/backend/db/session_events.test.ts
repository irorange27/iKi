// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import {
  appendSessionEvents,
  getSessionEventRevision,
  getSessionEvents,
} from '@iki/backend/db/session_events';

const event = (type: string, payload: unknown) => ({ type, version: 1, payload });

describe('session_events store', () => {
  let dataDir = '';

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-session-events-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'events.db') });
  });

  afterAll(async () => {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('assigns consecutive revisions and rejects a stale expectation atomically', () => {
    expect(getSessionEventRevision('thread_rev')).toBe(0);
    expect(appendSessionEvents('thread_rev', 0, [event('input_accepted', { messageId: 'm1' })])).toBe(1);
    expect(
      appendSessionEvents('thread_rev', 1, [
        event('turn_started', { runId: 'run_1' }),
        event('turn_completed', { runId: 'run_1' }),
      ])
    ).toBe(3);

    expect(appendSessionEvents('thread_rev', 1, [event('input_accepted', { messageId: 'late' })])).toBeNull();
    expect(getSessionEventRevision('thread_rev')).toBe(3);
    expect(getSessionEvents('thread_rev').map(e => e.type)).toEqual([
      'input_accepted',
      'turn_started',
      'turn_completed',
    ]);
    expect(getSessionEvents('thread_rev').map(e => e.revision)).toEqual([1, 2, 3]);

    const head = getSessionEventRevision('thread_rev');
    expect(appendSessionEvents('thread_rev', head, [event('input_accepted', { messageId: 'm2' })])).toBe(4);
  });

  it('keeps streams independent per thread', () => {
    appendSessionEvents('thread_a', 0, [event('input_accepted', { messageId: 'a1' })]);
    appendSessionEvents('thread_b', 0, [event('input_accepted', { messageId: 'b1' })]);
    expect(getSessionEventRevision('thread_a')).toBe(1);
    expect(getSessionEventRevision('thread_b')).toBe(1);
    expect(getSessionEvents('thread_a').map(e => (e.payload as { messageId: string }).messageId)).toEqual(['a1']);
  });
});
