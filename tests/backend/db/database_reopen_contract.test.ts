// The second face of issue #152. `initializeDatabase({ dbPath })` sets the
// per-open override and then early-returned the EXISTING handle when one was
// open — so an explicit path was silently ignored if a previous open was
// still live. A caller that opens a fresh file per test then wrote into the
// previous file's database, which after that file was removed surfaced as
// SQLite's `attempt to write a readonly database`. That is the intermittent
// failure in inline_execution_facts.integration.test.ts (seen on CI, and
// reproduced locally in 1 of 2 full-suite runs).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userDataMock = vi.hoisted(() => vi.fn(() => ''));
vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider, getProviders } from '@iki/backend/db/providers';

const providerRow = (id: string) => ({
  id,
  name: id,
  type: 'openai',
  api_key: 'k',
  models: '["m"]',
  enabled: true,
});

describe('initializeDatabase honours an explicit path', () => {
  let root = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-db-reopen-'));
    userDataMock.mockReturnValue(root);
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('opens the named file even when another database is already open', async () => {
    const first = path.join(root, 'first.db');
    const second = path.join(root, 'second.db');

    initializeDatabase({ dbPath: first });
    addProvider(providerRow('provider_first'));
    expect(getProviders().map(p => p.id)).toEqual(['provider_first']);

    // A second explicit open must REALLY open the second file. Before the fix
    // it returned the first handle, so this row landed in first.db.
    initializeDatabase({ dbPath: second });
    addProvider(providerRow('provider_second'));

    expect(getProviders().map(p => p.id)).toEqual(['provider_second']);
  });

  it('still reuses the handle when the SAME path is opened twice', () => {
    const only = path.join(root, 'only.db');
    const first = initializeDatabase({ dbPath: only });
    const second = initializeDatabase({ dbPath: only });
    expect(second).toBe(first);
  });
});
