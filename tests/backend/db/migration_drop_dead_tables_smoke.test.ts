import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';

// P5 migration smoke test — a REAL on-disk SQLite file, not a fake handle.
//
// The unit test for 007 asserts the statements it emits; this asserts what the
// bootstrap actually leaves on disk, which is the consumer boundary the user
// opens. Three paths matter and each has burned us before:
//  1. FRESH database: 001 CREATEs the two dead tables, 007 then DROPs them, so
//     the end state has neither;
//  2. RE-OPEN of the same file: 007 is recorded, so nothing is re-run and the
//     table set is unchanged (the runner's replay unit is the migration name);
//  3. UPGRADE of a database that already ran 001-006: it must STILL lose the
//     tables — this is why 007 is its own migration instead of being folded
//     into the baseline.
const created: string[] = [];

const freshPath = (label: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `p5-${label}-`));
  const file = path.join(dir, 'p5.db');
  created.push(dir);
  return file;
};

const tableNames = (file: string): Set<string> => {
  const raw = new DatabaseSync(file);
  try {
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    return new Set(rows.map(row => String(row.name)));
  } finally {
    raw.close();
  }
};

afterEach(() => {
  closeDatabase();
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('007_drop_dead_tables on a real database', () => {
  it('drops both dead tables on a fresh database and keeps durable state', () => {
    const dbPath = freshPath('fresh');

    initializeDatabase({ dbPath });
    const tables = tableNames(dbPath);

    expect(tables.has('agent_run_checkpoints')).toBe(false);
    expect(tables.has('tool_allowlist')).toBe(false);

    // Durable state the harness still reads must survive the same run.
    for (const table of [
      'agent_runs',
      'agent_run_steps',
      'session_events',
      'chat_messages',
      'chat_threads',
      'chat_thread_todos',
      'mcp_servers',
      'proactive_tasks',
      'awaiters',
    ]) {
      expect(tables.has(table), `${table} must survive`).toBe(true);
    }
  });

  it('leaves the MCP per-server tool_allowlist COLUMN intact', () => {
    const dbPath = freshPath('mcp');

    initializeDatabase({ dbPath });
    const raw = new DatabaseSync(dbPath);
    try {
      const columns = raw.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>;
      // Same name, different thing: this column is the live per-server tool
      // filter behind the MCP settings UI. Only the standalone learned-rule
      // TABLE is dead. Dropping the column would silently widen every server.
      expect(columns.map(column => String(column.name))).toContain('tool_allowlist');
    } finally {
      raw.close();
    }
  });

  it('is idempotent when the same file is opened twice', () => {
    const dbPath = freshPath('reopen');

    initializeDatabase({ dbPath });
    const first = tableNames(dbPath);

    closeDatabase();
    initializeDatabase({ dbPath });
    const second = tableNames(dbPath);

    expect([...second].sort()).toEqual([...first].sort());
    expect(second.has('agent_run_checkpoints')).toBe(false);
    expect(second.has('tool_allowlist')).toBe(false);

    const raw = new DatabaseSync(dbPath);
    try {
      const rows = raw
        .prepare("SELECT name FROM migrations WHERE name = '007_drop_dead_tables'")
        .all() as Array<{ name: string }>;
      expect(rows).toHaveLength(1);
    } finally {
      raw.close();
    }
  });

  it('drops the tables on a database that already ran 001-006', () => {
    const dbPath = freshPath('legacy');

    // Simulate the real upgrade: schema from the baseline era, 007 not applied.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE chat_threads (id TEXT PRIMARY KEY);
      CREATE TABLE agent_run_checkpoints (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_index INTEGER NOT NULL,
        reason TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE tool_allowlist (
        id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, pattern TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, executed_at TEXT NOT NULL
      );
    `);
    for (const name of [
      '001_baseline',
      '002_rename_chat_tool_approvals',
      '003_approval_session_workspace_selection',
      '004_approval_session_plan',
      '005_drop_memory_and_affect',
      '006_drop_thread_context',
    ]) {
      legacy
        .prepare('INSERT INTO migrations (name, executed_at) VALUES (?, ?)')
        .run(name, new Date().toISOString());
    }
    legacy.close();

    initializeDatabase({ dbPath });
    const tables = tableNames(dbPath);

    expect(tables.has('agent_run_checkpoints')).toBe(false);
    expect(tables.has('tool_allowlist')).toBe(false);
    expect(tables.has('chat_threads')).toBe(true);
  });
});
