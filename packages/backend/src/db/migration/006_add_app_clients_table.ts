import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (table: string, column: string): boolean => {
  const rows = getDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name?: string }>;
  return rows.some(row => row.name === column);
};

export const migration: Migration = {
  name: '006_add_app_clients_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS app_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL DEFAULT '[]',
        allowed_tools TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_app_clients_token_hash ON app_clients(token_hash);
    `);

    if (!columnExists('chat_threads', 'client_id')) {
      getDb().exec(`
        ALTER TABLE chat_threads ADD COLUMN client_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_chat_threads_client_id ON chat_threads(client_id);
      `);
    }
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS app_clients;');
    // Note: SQLite does not support DROP COLUMN; keep client_id if it exists.
  },
};
