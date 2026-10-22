import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = {
  tables: new Set<string>(),
  executed: new Set<string>(),
  executedStatements: [] as string[],
};

import type { SqliteDatabase } from '@iki/backend/db/sqlite';
import { initializeMigrations } from '@iki/backend/db/migration';

const makeFakeDb = (): SqliteDatabase =>
  ({
    exec: (statement: string) => void dbState.executedStatements.push(statement),
    prepare: (sql: string) => ({
      get: (...params: string[]) => {
        if (sql.includes('sqlite_master')) {
          // Two shapes: "name = ?" (does this table exist) and
          // "name NOT IN (...)" (is this a pre-baseline database).
          if (sql.includes('NOT IN')) {
            const excluded = new Set(params);
            const found = [...dbState.tables].find(table => !excluded.has(table));
            return found ? { name: found } : undefined;
          }
          const table = params[0];
          return dbState.tables.has(table) ? { name: table } : undefined;
        }
        if (sql.includes('FROM migrations WHERE name')) {
          const name = params[0];
          return dbState.executed.has(name) ? { name } : undefined;
        }
        return undefined;
      },
      all: (...names: string[]) =>
        [...dbState.executed].filter(name => names.includes(name)).map(name => ({ name })),
      run: (name: string) => void dbState.executed.add(name),
    }),
  }) as unknown as SqliteDatabase;

const KEY_TABLE_DDL_MARKER = 'CREATE TABLE IF NOT EXISTS chat_threads';

describe('initializeMigrations (post-squash baseline)', () => {
  beforeEach(() => {
    dbState.tables = new Set();
    dbState.executed.clear();
    dbState.executedStatements.length = 0;
  });

  it('runs the baseline on a fresh database', () => {
    initializeMigrations(makeFakeDb());

    expect(dbState.executedStatements.some(s => s.includes(KEY_TABLE_DDL_MARKER))).toBe(true);
    expect(dbState.executed.has('001_baseline')).toBe(true);
  });

  it('marks the baseline for pre-baseline databases without executing its DDL', () => {
    dbState.tables = new Set(['chat_threads']);

    initializeMigrations(makeFakeDb());

    expect(dbState.executed.has('001_baseline')).toBe(true);
    expect(dbState.executedStatements.some(s => s.includes(KEY_TABLE_DDL_MARKER))).toBe(false);
    expect(
      dbState.executedStatements
        .filter(s => !s.includes('migrations'))
        .some(s => s.includes('CREATE TABLE'))
    ).toBe(false);
  });

  it('is idempotent on re-initialization', () => {
    dbState.tables = new Set(['chat_threads']);
    initializeMigrations(makeFakeDb());
    const statementsAfterFirst = dbState.executedStatements
      .slice()
      .filter(s => !s.includes('migrations'));

    initializeMigrations(makeFakeDb());

    const newDdl = dbState.executedStatements
      .slice()
      .filter(s => !s.includes('migrations'))
      .filter(s => !statementsAfterFirst.includes(s));
    expect(newDdl).toEqual([]);
    expect(dbState.executed.has('001_baseline')).toBe(true);
  });
});
