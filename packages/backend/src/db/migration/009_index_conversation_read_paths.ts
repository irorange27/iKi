import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const INDEXES: ReadonlyArray<{ table: string; columns: readonly string[]; sql: string }> = [
  {

    table: 'chat_messages',
    columns: ['thread_id', 'timestamp', 'created_at', 'id'],
    sql: `CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_order
            ON chat_messages(thread_id, timestamp, created_at, id)`,
  },
  {

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

      if (!index.columns.every(column => tableHasColumn(db, index.table, column))) continue;
      db.exec(index.sql);
    }
  },
};

export { migration };
