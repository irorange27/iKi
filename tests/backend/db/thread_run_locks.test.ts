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

const database = await import('@iki/backend/db/database');
const { tryAcquireCrossProcessThreadRun } = await import(
  '@iki/backend/db/thread_run_locks'
);
const { getDb } = await import('@iki/backend/db/database');

let dataDir = '';

describe('thread_run_locks cross-process lease', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-run-locks-'));
    database.initializeDatabase({ dbPath: path.join(dataDir, 'test.db') });
  });



  it('blocks a second acquirer on the same thread and releases cleanly', () => {
    const release = tryAcquireCrossProcessThreadRun('thread_lock_1');
    expect(release).not.toBeNull();

    // Simulates another process (or an un-released attempt): same thread, new token.
    const contender = tryAcquireCrossProcessThreadRun('thread_lock_1');
    expect(contender).toBeNull();

    // Different threads are unaffected.
    const otherThread = tryAcquireCrossProcessThreadRun('thread_lock_2');
    expect(otherThread).not.toBeNull();
    otherThread();

    release!();
    release!(); // idempotent

    const reacquired = tryAcquireCrossProcessThreadRun('thread_lock_1');
    expect(reacquired).not.toBeNull();
    reacquired!();
  });

  it('reclaims an expired lease from a crashed holder', () => {
    const release = tryAcquireCrossProcessThreadRun('thread_lock_3');
    expect(release).not.toBeNull();

    // Simulate a crashed holder: force the lease row past its TTL without release.
    getDb()
      .prepare('UPDATE thread_run_locks SET expires_at = ? WHERE thread_id = ?')
      .run(Date.now() - 1, 'thread_lock_3');

    const reclaimed = tryAcquireCrossProcessThreadRun('thread_lock_3');
    expect(reclaimed).not.toBeNull();

    // The stale release from the crashed holder must not drop the new lease.
    release!();
    const stillHeld = getDb()
      .prepare('SELECT token FROM thread_run_locks WHERE thread_id = ?')
      .get('thread_lock_3');
    expect(stillHeld).not.toBeNull();

    reclaimed!();
  });

  it('leaves no lock rows after clean lifecycles', () => {
    const release = tryAcquireCrossProcessThreadRun('thread_lock_4');
    release!();
    const rows = getDb().prepare('SELECT * FROM thread_run_locks').all();
    expect(rows).toHaveLength(0);
  });
});

describe('thread_run_locks loss detection and cross-process contention', () => {
  it('fires onLeaseLost once when another process reclaims the expired lease', async () => {
    const lost = vi.fn();
    const release = tryAcquireCrossProcessThreadRun('thread_lock_5', {
      onLeaseLost: lost,
      refreshIntervalMs: 40,
    });
    expect(release).not.toBeNull();

    // Crash the holder's timing: expire the row, let another process reclaim.
    getDb()
      .prepare('UPDATE thread_run_locks SET expires_at = ? WHERE thread_id = ?')
      .run(Date.now() - 1, 'thread_lock_5');
    const reclaimed = tryAcquireCrossProcessThreadRun('thread_lock_5');
    expect(reclaimed).not.toBeNull();

    await new Promise(resolve => setTimeout(resolve, 200));
    expect(lost).toHaveBeenCalledTimes(1);

    // The stale holder's release must not drop the new holder's lease row.
    release!();
    const stillHeld = getDb()
      .prepare('SELECT token FROM thread_run_locks WHERE thread_id = ?')
      .get('thread_lock_5');
    expect(stillHeld).not.toBeNull();
    reclaimed!();
  });

  it('sees a lease held by a real second OS process through its own connection', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const otherProcessToken = 'runlease_from_other_process';
    const insertLease = `const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(path.join(dataDir, 'test.db'))});
      db.exec('BEGIN IMMEDIATE');
      db.prepare("DELETE FROM thread_run_locks WHERE expires_at <= ?").run(Date.now());
      db.prepare('INSERT OR IGNORE INTO thread_run_locks (thread_id, token, expires_at) VALUES (?, ?, ?)').run('thread_lock_6', ${JSON.stringify(otherProcessToken)}, Date.now() + 60000);
      db.exec('COMMIT');`;

    await execFileAsync(process.execPath, ['-e', insertLease]);
    // The other process holds the thread: this process must see busy.
    expect(tryAcquireCrossProcessThreadRun('thread_lock_6')).toBeNull();

    const dropLease = `const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(path.join(dataDir, 'test.db'))});
      db.prepare('DELETE FROM thread_run_locks WHERE token = ?').run(${JSON.stringify(otherProcessToken)});`;
    await execFileAsync(process.execPath, ['-e', dropLease]);

    const acquired = tryAcquireCrossProcessThreadRun('thread_lock_6');
    expect(acquired).not.toBeNull();
    acquired!();
  });
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});
