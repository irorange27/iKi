import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// Two read paths in the conversation surface were full table scans.
//
// `chat_messages` had NO index on `thread_id` — only its `id` PRIMARY KEY. The
// list query is `WHERE thread_id = ? ORDER BY timestamp, created_at, id`, so
// SQLite scanned EVERY message of EVERY conversation and then sorted the
// result in a temp B-tree. Measured on an in-memory database with 2 KB
// messages, the cost is linear in the TOTAL row count, not in the
// conversation's own length:
//
//   threads   rows    no index    indexed
//        10    300    0.060 ms   0.027 ms
//       100   3000    0.204 ms   0.027 ms
//       500  15000    1.250 ms   0.028 ms
//      1000  30000    6.726 ms   0.027 ms
//
// The indexed column order is the ORDER BY order, so the sort disappears
// entirely (`SEARCH ... USING INDEX` instead of `SCAN` + `USE TEMP B-TREE`).
// This is not a micro-optimisation for a large install: a conversation list
// is read on every render, and the scan grows with how long the app has been
// used rather than with what the user is looking at.
//
// `chat_threads` list (`ORDER BY updated_at DESC`, no WHERE) scanned and
// sorted the same way. `updated_at DESC` as the index order lets SQLite walk
// the index in output order (`SCAN ... USING INDEX`, no temp B-tree).
//
// BOTH INDEXES ARE GUARDED ON THE TABLE AND ITS COLUMNS EXISTING.
// `CREATE INDEX IF NOT EXISTS` guards the INDEX, not the schema it references:
// on a database whose `chat_messages` predates the current column set (a
// hand-built fixture, a partially-restored file, a pre-squash generation) it
// throws `no such table` or `no such column`, and a migration that throws
// during open makes the whole application unopenable.
//
// The guard is an explicit `sqlite_master` / `PRAGMA table_info` lookup rather
// than a try/catch: a genuine failure (a malformed index definition, a
// permissions problem) must still surface instead of being swallowed as
// "schema missing".
const INDEXES: ReadonlyArray<{ table: string; columns: readonly string[]; sql: string }> = [
  {
    // Column order matches getChatMessages' ORDER BY so the sort is satisfied
    // by the index. `id` is the tiebreaker the query already uses.
    table: 'chat_messages',
    columns: ['thread_id', 'timestamp', 'created_at', 'id'],
    sql: `CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_order
            ON chat_messages(thread_id, timestamp, created_at, id)`,
  },
  {
    // The conversation list is `ORDER BY updated_at DESC` with no predicate;
    // a descending index lets SQLite return rows in that order directly.
    table: 'chat_threads',
    columns: ['updated_at'],
    sql: `CREATE INDEX IF NOT EXISTS idx_chat_threads_updated_at
            ON chat_threads(updated_at DESC)`,
  },
];

const tableExists = (db: SqliteDatabase, table: string): boolean =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );

const tableHasColumn = (db: SqliteDatabase, table: string, column: string): boolean => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  return rows.some(row => String(row.name) === column);
};

const migration: Migration = {
  name: '009_index_conversation_read_paths',
  up: (db: SqliteDatabase) => {
    for (const index of INDEXES) {
      if (!tableExists(db, index.table)) continue;
      // A table can exist with an older column set; indexing a column it does
      // not have throws just as hard as indexing a table that does not exist.
      if (!index.columns.every(column => tableHasColumn(db, index.table, column))) continue;
      db.exec(index.sql);
    }
  },
};

export { migration };
