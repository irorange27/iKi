import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = {
  hasUserTable: false,
  executed: new Set<string>(),
  executedStatements: [] as string[],
};

vi.mock('@iki/backend/db/database', () => ({
  getDb: () => ({
    exec: (statement: string) => void dbState.executedStatements.push(statement),
    prepare: (sql: string) => ({
      get: () =>
        sql.includes('sqlite_master')
          ? dbState.hasUserTable
            ? { name: 'chat_threads' }
            : undefined
          : undefined,
      all: (...names: string[]) =>
        [...dbState.executed].filter(name => names.includes(name)).map(name => ({ name })),
      run: (name: string) => void dbState.executed.add(name),
    }),
  }),
}));

vi.mock('@iki/backend/db/migration/runner', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/db/migration/runner')>();
  return actual;
});

import { initializeMigrations } from '@iki/backend/db/migration';

const KEY_TABLE_DDL_MARKER = 'CREATE TABLE IF NOT EXISTS chat_threads';

describe('initializeMigrations (post-squash baseline)', () => {
  beforeEach(() => {
    dbState.hasUserTable = false;
    dbState.executed.clear();
    dbState.executedStatements.length = 0;
  });

  it('runs the baseline on a fresh database', () => {
    initializeMigrations();

    expect(dbState.executedStatements.some(s => s.includes(KEY_TABLE_DDL_MARKER))).toBe(true);
    expect(dbState.executed.has('001_baseline')).toBe(true);
  });

  it('marks the baseline for pre-baseline databases without executing its DDL', () => {
    dbState.hasUserTable = true;

    initializeMigrations();

    expect(dbState.executed.has('001_baseline')).toBe(true);
    expect(dbState.executedStatements.some(s => s.includes(KEY_TABLE_DDL_MARKER))).toBe(false);
    // only bookkeeping (the migrations table) may be created — no baseline DDL
    expect(dbState.executedStatements.every(s => s.includes('migrations'))).toBe(true);
  });

  it('is idempotent on re-initialization', () => {
    dbState.hasUserTable = true;
    initializeMigrations();
    const statementsAfterFirst = dbState.executedStatements.length;

    initializeMigrations();

    // no baseline DDL appears on re-initialization; only bookkeeping may run
    expect(dbState.executedStatements.slice(statementsAfterFirst).every(s => s.includes('migrations'))).toBe(true);
    expect(dbState.executed.has('001_baseline')).toBe(true);
  });
});
