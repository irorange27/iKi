import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '025_add_chat_thread_todos_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS chat_thread_todos (
        thread_id TEXT PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
        items TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_thread_todos_updated
        ON chat_thread_todos(updated_at DESC);
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS chat_thread_todos;');
  },
};
