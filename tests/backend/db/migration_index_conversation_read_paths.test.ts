import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { getChatMessages, addChatMessage } from '@iki/backend/db/chat_message';
import { getChatThreads, addChatThread } from '@iki/backend/db/chat_thread';

// 009 migration — the conversation read paths must SEARCH an index, not SCAN
// the table.
//
// This asserts the QUERY PLAN rather than a duration, because a timing
// assertion is a flaky test on CI while the plan is the thing that actually
// determines the scaling behaviour. The measured reason: with no index on
// `thread_id`, listing one conversation scans every message of every
// conversation, so the cost grows with how long the app has been used
// (0.06 ms at 300 rows, 6.7 ms at 30 000) instead of with what is being read.
// With the index it is flat.
//
// A plan assertion is also the only check that stays true as the data grows:
// a fast laptop can hide a 1 ms scan on an empty table.
const created: string[] = [];

const freshDb = (label: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `m009-${label}-`));
  created.push(dir);
  return path.join(dir, 'm009.db');
};

/** The exact statements the two db modules issue. Kept here as SQL so the
 *  assertion is about the plan the PRODUCTION query gets, not about a
 *  hand-written probe that could drift from it. */
const CHAT_MESSAGES_QUERY =
  'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY timestamp ASC, created_at ASC, id ASC';
const CHAT_THREADS_QUERY = 'SELECT * FROM chat_threads ORDER BY updated_at DESC';

const planFor = (sql: string): string[] =>
  (getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map(row =>
    String(row.detail)
  );

afterEach(() => {
  closeDatabase();
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('009_index_conversation_read_paths', () => {
  it('makes the conversation read a SEARCH, with no temp sort', () => {
    initializeDatabase({ dbPath: freshDb('plan-messages') });

    const plan = planFor(CHAT_MESSAGES_QUERY);
    const joined = plan.join(' | ');

    // SEARCH ... USING INDEX, not SCAN.
    expect(plan.some(detail => /^SEARCH chat_messages USING INDEX/.test(detail))).toBe(true);
    // No full table scan.
    expect(joined).not.toMatch(/SCAN chat_messages/);
    // No temp B-tree: the index column order satisfies ORDER BY, so the sort
    // is free. This is the half that a naive `(thread_id)` index would miss.
    expect(joined).not.toMatch(/TEMP B-TREE/);
  });

  it('makes the conversation list a SEARCH, with no temp sort', () => {
    initializeDatabase({ dbPath: freshDb('plan-threads') });

    const plan = planFor(CHAT_THREADS_QUERY);
    const joined = plan.join(' | ');

    expect(plan.some(detail => /USING INDEX/.test(detail))).toBe(true);
    expect(joined).not.toMatch(/TEMP B-TREE/);
  });

  it('returns the same rows it did before the index existed', () => {
    // An index must not change results — including the ordering, which is the
    // part a wrong column order would silently alter.
    initializeDatabase({ dbPath: freshDb('semantics') });

    addChatThread({ id: 'thread_a', title: 'A', metadata: '{}' });
    addChatThread({ id: 'thread_b', title: 'B', metadata: '{}' });

    // Deliberately inserted out of order, and with a timestamp tie broken by
    // created_at then id — the exact three-level ordering the query promises.
    addChatMessage({
      id: 'msg_3',
      thread_id: 'thread_a',
      message: '{"id":"msg_3","role":"user","parts":[{"type":"text","text":"third"}]}',
      timestamp: '2026-01-01T00:00:02.000Z',
      metadata: '{}',
    });
    addChatMessage({
      id: 'msg_1',
      thread_id: 'thread_a',
      message: '{"id":"msg_1","role":"user","parts":[{"type":"text","text":"first"}]}',
      timestamp: '2026-01-01T00:00:00.000Z',
      metadata: '{}',
    });
    addChatMessage({
      id: 'msg_2',
      thread_id: 'thread_a',
      message: '{"id":"msg_2","role":"user","parts":[{"type":"text","text":"second"}]}',
      timestamp: '2026-01-01T00:00:01.000Z',
      metadata: '{}',
    });
    // A different thread's message must never leak into the result.
    addChatMessage({
      id: 'msg_b',
      thread_id: 'thread_b',
      message: '{"id":"msg_b","role":"user","parts":[{"type":"text","text":"other"}]}',
      timestamp: '2026-01-01T00:00:00.500Z',
      metadata: '{}',
    });

    expect(getChatMessages('thread_a').map(row => row.id)).toEqual(['msg_1', 'msg_2', 'msg_3']);
    expect(getChatMessages('thread_b').map(row => row.id)).toEqual(['msg_b']);
    expect(getChatThreads().map(thread => thread.id).sort()).toEqual(['thread_a', 'thread_b']);
  });

  it('is idempotent and does not disturb an existing database', () => {
    const dbPath = freshDb('reopen');

    initializeDatabase({ dbPath });
    const indexesAfterFirst = (
      getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('chat_messages','chat_threads')"
        )
        .all() as Array<{ name: string }>
    ).map(row => String(row.name));

    closeDatabase();
    initializeDatabase({ dbPath });
    const indexesAfterSecond = (
      getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('chat_messages','chat_threads')"
        )
        .all() as Array<{ name: string }>
    ).map(row => String(row.name));

    expect([...indexesAfterSecond].sort()).toEqual([...indexesAfterFirst].sort());
    expect(indexesAfterSecond).toContain('idx_chat_messages_thread_order');
    expect(indexesAfterSecond).toContain('idx_chat_threads_updated_at');

    const rows = getDb()
      .prepare("SELECT name FROM migrations WHERE name = '009_index_conversation_read_paths'")
      .all() as Array<{ name: string }>;
    expect(rows).toHaveLength(1);
  });

  it('does not throw on a database whose schema predates these columns', () => {
    // `CREATE INDEX IF NOT EXISTS` guards the INDEX, not the schema it
    // references. A hand-built or partially-restored file can have
    // `chat_messages` without `created_at`, or no `chat_threads` at all, and a
    // migration that throws during open makes the whole application
    // unopenable. This pins the guard.
    const dbPath = freshDb('old-schema');

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, message TEXT NOT NULL
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
      '007_drop_dead_tables',
      '008_drop_clipboard_snapshots',
    ]) {
      legacy
        .prepare('INSERT INTO migrations (name, executed_at) VALUES (?, ?)')
        .run(name, new Date().toISOString());
    }
    legacy.close();

    // The open itself is the assertion: it must not throw.
    expect(() => initializeDatabase({ dbPath })).not.toThrow();

    // The index on the incomplete table is skipped; the one whose table is
    // simply absent is skipped too. Neither leaves a half-built index.
    const indexes = (
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_chat_%'")
        .all() as Array<{ name: string }>
    ).map(row => String(row.name));
    expect(indexes).not.toContain('idx_chat_messages_thread_order');
    expect(indexes).not.toContain('idx_chat_threads_updated_at');
  });
});
