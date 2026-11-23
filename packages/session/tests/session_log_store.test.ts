import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonlSessionLogStore } from '../src/session_log_store';

const tempDirs: string[] = [];

const makeStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-session-test-'));
  tempDirs.push(dir);
  return { dir, store: createJsonlSessionLogStore(dir) };
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('JsonlSessionLogStore', () => {
  it('appends batches, enforces optimistic concurrency, and repairs torn tail lines', () => {
    const { dir, store } = makeStore();

    const rev1 = store.append('t1', 0, [
      { type: 'input_accepted', version: 1, payload: { runId: 'r1', text: 'hello' } },
      { type: 'turn_started', version: 1, payload: { runId: 'r1' } },
    ]);
    expect(rev1).toBe(2);
    expect(store.headRevision('t1')).toBe(2);

    // Stale expectedRevision must be rejected without mutating the stream
    const stale = store.append('t1', 1, [
      { type: 'turn_completed', version: 1, payload: { runId: 'r1' } },
    ]);
    expect(stale).toBeNull();
    expect(store.headRevision('t1')).toBe(2);

    // Simulate crash mid-write leaving a torn trailing line
    const file = path.join(dir, 't1.jsonl');
    fs.appendFileSync(file, '{"kind":"batch","firstRevision":3,"events":[', 'utf8');

    const rev2 = store.append('t1', 2, [
      { type: 'turn_completed', version: 1, payload: { runId: 'r1' } },
    ]);
    expect(rev2).toBe(3);

    const events = store.readThread('t1');
    expect(events.map(e => `${e.revision}:${e.type}`)).toEqual([
      '1:input_accepted',
      '2:turn_started',
      '3:turn_completed',
    ]);
  });
});
