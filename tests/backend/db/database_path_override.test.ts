// Regression for issue #152: `closeDatabase()` left `dbPathOverride` in place,
// so the next IMPLICIT `getDb()` resolved to the PREVIOUS open's database.
// With per-file temp databases (what the #145 thread_session suites use), a
// later file then wrote into an earlier file's rows — which is what made
// `inline_execution_facts` fail intermittently with
// `UNIQUE constraint failed: providers.id` when the whole suite ran.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userDataMock = vi.hoisted(() => vi.fn(() => ''));
vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { addProvider, getProviders } from '@iki/backend/db/providers';

describe('database path override lifetime', () => {
  let root: string;
  let explicitPath: string;
  let implicitPath: string;
  let providerId: string;

  beforeEach(async () => {
    // The implicit open must resolve through getUserDataPath, not a shared
    // IKI_DB_PATH another file may have written rows into.
    vi.stubEnv('IKI_DB_PATH', '');
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-db-override-'));
    explicitPath = path.join(root, 'explicit.db');
    implicitPath = path.join(root, 'iKi_v0.db');
    // An un-parameterized open must resolve here, never to explicit.db.
    userDataMock.mockReturnValue(root);
    providerId = `provider_${process.pid}_${Date.now()}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resolves an implicit open to the user-data path, not the previous open', () => {
    // First open names its own database and records a row there.
    initializeDatabase({ dbPath: explicitPath });
    addProvider({
      id: providerId,
      name: 'first',
      type: 'openai',
      api_key: 'k',
      models: '["m"]',
      enabled: true,
    });
    expect(getProviders().map(p => p.id)).toEqual([providerId]);
    closeDatabase();

    // Second open names NO path. Before the fix the stale override sent it
    // back to explicit.db, where `providerId` already existed, so this insert
    // threw UNIQUE constraint failed: providers.id.
    getDb();

    expect(() =>
      addProvider({
        id: providerId,
        name: 'second',
        type: 'openai',
        api_key: 'k',
        models: '["m"]',
        enabled: true,
      })
    ).not.toThrow();

    // The implicit open created its own file and left the explicit one alone.
    expect(existsSync(implicitPath)).toBe(true);
    expect(getProviders().map(p => p.id)).toEqual([providerId]);
  });
});
