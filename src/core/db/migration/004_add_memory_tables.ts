import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '004_add_memory_tables',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS memory_short (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT,
        importance REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_memory_short_thread ON memory_short(thread_id);
      CREATE INDEX IF NOT EXISTS idx_memory_short_updated ON memory_short(updated_at);

      CREATE TABLE IF NOT EXISTS memory_long (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding TEXT NOT NULL,
        source_message_ids TEXT,
        emotion TEXT,
        tags TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_memory_long_thread ON memory_long(thread_id);
      CREATE INDEX IF NOT EXISTS idx_memory_long_updated ON memory_long(updated_at);
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS memory_long;');
    getDb().exec('DROP TABLE IF EXISTS memory_short;');
  },
};
