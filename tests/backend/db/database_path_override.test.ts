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
    vi.stubEnv('IKI_DB_PATH', '');
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-db-override-'));
    explicitPath = path.join(root, 'explicit.db');
    implicitPath = path.join(root, 'iKi_v0.db');
    userDataMock.mockReturnValue(root);
    providerId = `provider_${process.pid}_${Date.now()}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resolves an implicit open to the user-data path, not the previous open', () => {
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

    expect(existsSync(implicitPath)).toBe(true);
    expect(getProviders().map(p => p.id)).toEqual([providerId]);
  });
});
