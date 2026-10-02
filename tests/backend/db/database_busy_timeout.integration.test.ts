// @vitest-environment node

import { spawn } from 'node:child_process';
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
import { appendSessionEvents, getSessionEvents } from '@iki/backend/db/session_events';

// desktop and daemon share one SQLite file across PROCESSES. A writer must
// queue behind another process's transaction (busy_timeout) instead of
// failing immediately with "database is locked" — the session log's short
// appends exposed the missing timeout (issue #48). The lock holder here is
// a real child process: same-process connections cannot exercise this,
// because a synchronous write blocks the event loop the holder's timer
// would need.
describe('database busy timeout', () => {
  let dataDir = '';
  let dbPath = '';

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-busy-timeout-'));
    dbPath = path.join(dataDir, 'shared.db');
    initializeDatabase({ dbPath });
  });

  afterAll(async () => {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('waits out another process’s write lock instead of failing', async () => {
    // The child holds the write lock for ~300ms, then commits and exits.
    // It signals "lock held" on stdout — no fixed sleep racing its boot.
    const holder = spawn(
      process.execPath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite');
         const db = new DatabaseSync(${JSON.stringify(dbPath)});
         db.exec('BEGIN IMMEDIATE');
         process.stdout.write('LOCKED');
         setTimeout(() => { db.exec('COMMIT'); }, 300);`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    await new Promise<void>(resolve => {
      holder.stdout.on('data', chunk => {
        if (String(chunk).includes('LOCKED')) resolve();
      });
    });

    const start = Date.now();
    const head = appendSessionEvents('thread_lock', 0, [
      { type: 'input_accepted', version: 1, payload: { messageId: 'm1' } },
    ]);
    const waited = Date.now() - start;
    expect(head).toBe(1);
    expect(getSessionEvents('thread_lock')).toHaveLength(1);
    // The append queued on the lock instead of failing instantly. The
    // holder frees it ~300ms after signalling, so a sub-100ms wait means it
    // never raced the lock at all.
    expect(waited).toBeGreaterThanOrEqual(100);
    await new Promise(resolve => holder.on('exit', resolve));
  });
});
