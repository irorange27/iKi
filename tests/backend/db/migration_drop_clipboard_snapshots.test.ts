import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';

// 008 migration smoke test — a REAL on-disk SQLite file.
//
// `clipboard_snapshots` is unusual among dead tables: `001_baseline.ts` does
// NOT create it, so a fresh install never has it and the migration is a no-op
// there. It exists only in databases that predate the squash, which is the
// case that actually needs the drop and the one a baseline-only test would
// never exercise.
//
// Four paths, because they fail differently:
//  1. FRESH database — nothing to drop; asserts the migration is harmless and
//     does not invent the table.
//  2. PRE-SQUASH database that still has the table — the real upgrade; asserts
//     the table AND its two indexes are gone.
//  3. RE-OPEN — 008 recorded, nothing re-runs, table set unchanged.
//  4. A database that already ran 001-007 — must STILL lose this table, which
//     is the whole reason 008 is separate from 007.
const created: string[] = [];

const freshPath = (label: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `m008-${label}-`));
  const file = path.join(dir, 'm008.db');
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

const indexNamesFor = (file: string, table: string): Set<string> => {
  const raw = new DatabaseSync(file);
  try {
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
      .all(table) as Array<{ name: string }>;
    return new Set(rows.map(row => String(row.name)));
  } finally {
    raw.close();
  }
};

/** The pre-squash shape of the table, as the runtime database carries it. */
const CREATE_CLIPBOARD_SNAPSHOTS = `
  CREATE TABLE clipboard_snapshots (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    content_preview TEXT NOT NULL,
    content_length INTEGER NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'text/plain',
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_clipboard_snapshots_captured ON clipboard_snapshots(captured_at);
  CREATE INDEX idx_clipboard_snapshots_hash ON clipboard_snapshots(content_hash);
`;

/** Mark every migration up to (and including) `last` as already executed. */
const markExecuted = (db: DatabaseSync, names: readonly string[]) => {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executed_at TEXT NOT NULL
  );`);
  for (const name of names) {
    db.prepare('INSERT INTO migrations (name, executed_at) VALUES (?, ?)').run(
      name,
      new Date().toISOString()
    );
  }
};

const UP_TO_007 = [
  '001_baseline',
  '002_rename_chat_tool_approvals',
  '003_approval_session_workspace_selection',
  '004_approval_session_plan',
  '005_drop_memory_and_affect',
  '006_drop_thread_context',
  '007_drop_dead_tables',
] as const;

afterEach(() => {
  closeDatabase();
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('008_drop_clipboard_snapshots on a real database', () => {
  it('is a no-op on a fresh database, which never creates the table', () => {
    const dbPath = freshPath('fresh');

    initializeDatabase({ dbPath });
    const tables = tableNames(dbPath);

    // The baseline does not create it, so a fresh install must not have it —
    // and the migration must not have invented it either.
    expect(tables.has('clipboard_snapshots')).toBe(false);
    // Durable state the harness reads must be unaffected by running 008.
    for (const table of ['session_events', 'chat_messages', 'agent_runs', 'chat_threads']) {
      expect(tables.has(table), `${table} must survive`).toBe(true);
    }
  });

  it('drops the table and both of its indexes on a pre-squash database', () => {
    const dbPath = freshPath('legacy');

    // A database from before the squash: the table exists with its indexes,
    // and every migration through 007 is recorded.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(CREATE_CLIPBOARD_SNAPSHOTS);
    legacy.exec('CREATE TABLE chat_threads (id TEXT PRIMARY KEY)');
    markExecuted(legacy, UP_TO_007);
    legacy.close();

    expect(tableNames(dbPath).has('clipboard_snapshots')).toBe(true);
    expect(indexNamesFor(dbPath, 'clipboard_snapshots').size).toBeGreaterThan(0);

    initializeDatabase({ dbPath });

    expect(tableNames(dbPath).has('clipboard_snapshots')).toBe(false);
    // SQLite drops a table's indexes with it; asserting the count rather than
    // each name catches a leftover index that survived as an orphan object.
    expect(indexNamesFor(dbPath, 'clipboard_snapshots').size).toBe(0);
    // The rest of the schema is untouched.
    expect(tableNames(dbPath).has('chat_threads')).toBe(true);
  });

  it('is idempotent when the same file is opened twice', () => {
    const dbPath = freshPath('reopen');

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(CREATE_CLIPBOARD_SNAPSHOTS);
    legacy.exec('CREATE TABLE chat_threads (id TEXT PRIMARY KEY)');
    markExecuted(legacy, UP_TO_007);
    legacy.close();

    initializeDatabase({ dbPath });
    const first = tableNames(dbPath);

    closeDatabase();
    initializeDatabase({ dbPath });
    const second = tableNames(dbPath);

    expect([...second].sort()).toEqual([...first].sort());
    expect(second.has('clipboard_snapshots')).toBe(false);

    // Recorded exactly once — the runner's replay unit is the migration name.
    const raw = new DatabaseSync(dbPath);
    try {
      const rows = raw
        .prepare("SELECT name FROM migrations WHERE name = '008_drop_clipboard_snapshots'")
        .all() as Array<{ name: string }>;
      expect(rows).toHaveLength(1);
    } finally {
      raw.close();
    }
  });

  it('drops the table on a database that only ran up to 006', () => {
    const dbPath = freshPath('upgrade-006');

    // 007 not yet applied either: this run must land BOTH 007 and 008, which
    // is what makes them independent units rather than one folded step.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(CREATE_CLIPBOARD_SNAPSHOTS);
    legacy.exec('CREATE TABLE chat_threads (id TEXT PRIMARY KEY)');
    legacy.exec(`CREATE TABLE agent_run_checkpoints (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_index INTEGER NOT NULL,
      reason TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    legacy.exec(`CREATE TABLE tool_allowlist (
      id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, pattern TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    markExecuted(legacy, UP_TO_007.slice(0, 6));
    legacy.close();

    initializeDatabase({ dbPath });
    const tables = tableNames(dbPath);

    expect(tables.has('clipboard_snapshots')).toBe(false);
    expect(tables.has('agent_run_checkpoints')).toBe(false);
    expect(tables.has('tool_allowlist')).toBe(false);
    expect(tables.has('chat_threads')).toBe(true);
  });
});
