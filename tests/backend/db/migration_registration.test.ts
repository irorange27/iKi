import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registeredMigrations } from '@iki/backend/db/migration';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, '../../../packages/backend/src');

const migrationDir = path.join(backendDir, 'db/migration');
const dbDir = path.join(backendDir, 'db');

const migrationFiles = readdirSync(migrationDir)
  .filter(fileName => /^\d{3}_.+\.ts$/.test(fileName))
  .sort();

const readMigrationSources = (): string =>
  migrationFiles.map(fileName => readFileSync(path.join(migrationDir, fileName), 'utf-8')).join('\n');

// Every table name the runtime db layer reads or writes. Only string literals
// that open with a SQL verb count: prose in error messages and comments also
// says "update", and `DO UPDATE SET` is not a table name either.
const SQL_STATEMENT = /^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;

// `ON CONFLICT(thread_id) DO UPDATE SET` reads like an UPDATE of a table called
// SET, and `INSERT OR REPLACE INTO` is followed by a real name. Keywords are not
// table names.
const SQL_KEYWORDS = new Set(['set', 'values', 'select', 'table', 'where', 'and', 'or']);

const queriedTables = (): Set<string> => {
  const tables = new Set<string>();
  for (const fileName of readdirSync(dbDir)) {
    if (!fileName.endsWith('.ts')) continue;
    const source = readFileSync(path.join(dbDir, fileName), 'utf-8');
    for (const literal of source.matchAll(/[`'"]([^`'"]*)[`'"]/g)) {
      const sql = literal[1];
      if (!SQL_STATEMENT.test(sql)) continue;
      for (const match of sql.matchAll(/\b(?:FROM|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)\b/gi)) {
        if (SQL_KEYWORDS.has(match[1].toLowerCase())) continue;
        tables.add(match[1]);
      }
    }
  }
  return tables;
};

// Tables a migration creates, ignoring the ones it also drops: a create+drop
// pair is dead DDL that the schema should not carry.
const createdTables = (): string[] => {
  const created = new Set<string>();
  const dropped = new Set<string>();
  for (const fileName of migrationFiles) {
    const source = readFileSync(path.join(migrationDir, fileName), 'utf-8');
    for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS "?([a-z_][a-z0-9_]*)"?/gi)) {
      created.add(match[1]);
    }
    for (const match of source.matchAll(/DROP TABLE IF EXISTS "?([a-z_][a-z0-9_]*)"?/gi)) {
      dropped.add(match[1]);
    }
  }
  return [...created].filter(table => !dropped.has(table));
};

describe('migration schema', () => {
  it('creates exactly the tables the db layer queries', () => {
    const created = new Set(createdTables());
    const queried = queriedTables();
    const coreTables = new Set(['config', 'providers', 'session_events', 'thread_run_locks']);

    const missing = [...queried].filter(table => !created.has(table) && !coreTables.has(table));
    const orphaned = [...created].filter(table => !queried.has(table));

    expect({ missing, orphaned }).toEqual({ missing: [], orphaned: [] });
  });

  it('never creates a table that a migration later drops', () => {
    const created = createdTables();
    const dropped = new Set<string>();
    for (const fileName of migrationFiles) {
      const source = readFileSync(path.join(migrationDir, fileName), 'utf-8');
      for (const match of source.matchAll(/DROP TABLE IF EXISTS "?([a-z_][a-z0-9_]*)"?/gi)) {
        dropped.add(match[1]);
      }
    }

    expect(created.filter(table => dropped.has(table))).toEqual([]);
  });

  it('declares every registered migration as a file, numbered from 1', () => {
    const fileNumbers = migrationFiles.map(fileName => Number.parseInt(fileName.slice(0, 3), 10));

    expect(fileNumbers).toEqual(
      Array.from({ length: migrationFiles.length }, (_value, index) => index + 1)
    );
    expect(registeredMigrations.map(migration => migration.name)).toEqual(
      migrationFiles.map(fileName => fileName.replace(/\.ts$/, ''))
    );
  });

  it('does not index a table the schema never creates', () => {
    const created = new Set(createdTables());
    const coreTables = new Set(['config', 'providers', 'session_events', 'thread_run_locks']);
    const indexedOn = [...readMigrationSources().matchAll(/ON\s+"?([a-z_][a-z0-9_]*)"?\s*\(/gi)].map(
      match => match[1]
    );

    expect(indexedOn.filter(table => !created.has(table) && !coreTables.has(table))).toEqual([]);
  });
});
