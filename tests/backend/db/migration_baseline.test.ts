import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake DB state. `tables` simulates pre-existing tables on a database created
// before the migration squash; sqlite_master lookups only report tables that
// this set contains (migrations query them by literal name).
const dbState = {
  tables: new Set<string>(),
  executed: new Set<string>(),
  executedStatements: [] as string[],
};

vi.mock('@iki/backend/db/database', () => ({
  getDb: () => ({
    exec: (statement: string) => void dbState.executedStatements.push(statement),
    prepare: (sql: string) => ({
      get: (...params: string[]) => {
        if (sql.includes('sqlite_master')) {
          // Parameterized table probe (migration 002): report only tables the
          // pre-existing schema actually contains.
          const table = params[0];
          if (table) return dbState.tables.has(table) ? { name: table } : undefined;
          // General schema probe: any user table at all?
          return dbState.tables.size > 0 ? { name: [...dbState.tables][0] } : undefined;
        }
        return undefined;
      },
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
    dbState.tables = new Set();
    dbState.executed.clear();
    dbState.executedStatements.length = 0;
  });

  it('runs the baseline on a fresh database', () => {
    initializeMigrations();

    expect(dbState.executedStatements.some(s => s.includes(KEY_TABLE_DDL_MARKER))).toBe(true);
    expect(dbState.executed.has('001_baseline')).toBe(true);
  });

  it('marks the baseline for pre-baseline databases without executing its DDL', () => {
    dbState.tables = new Set(['chat_threads']);

    initializeMigrations();

    expect(dbState.executed.has('001_baseline')).toBe(true);
    expect(dbState.executedStatements.some(s => s.includes(KEY_TABLE_DDL_MARKER))).toBe(false);
    // Post-baseline migrations (e.g. 002 renaming the tool-call approval
    // tables) legitimately run for pre-squash databases — only the squashed
    // baseline DDL must stay dormant. (The migrations bookkeeping table
    // statement re-runs every time and is ignored.)
    expect(
      dbState.executedStatements
        .filter(s => !s.includes('migrations'))
        .some(s => s.includes('CREATE TABLE'))
    ).toBe(false);
  });

  it('is idempotent on re-initialization', () => {
    dbState.tables = new Set(['chat_threads']);
    initializeMigrations();
    const statementsAfterFirst = dbState.executedStatements
      .slice()
      .filter(s => !s.includes('migrations'));

    initializeMigrations();

    // no migration DDL appears on re-initialization (the migrations
    // bookkeeping table statement re-runs every time and is ignored)
    const newDdl = dbState.executedStatements
      .slice()
      .filter(s => !s.includes('migrations'))
      .filter(s => !statementsAfterFirst.includes(s));
    expect(newDdl).toEqual([]);
    expect(dbState.executed.has('001_baseline')).toBe(true);
  });
});
