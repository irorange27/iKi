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
    expect(waited).toBeGreaterThanOrEqual(100);
    await new Promise(resolve => holder.on('exit', resolve));
  });
});
