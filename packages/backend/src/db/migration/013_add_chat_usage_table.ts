import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '013_add_chat_usage_table',
  aliases: ['012_add_chat_usage_table'],
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS chat_usage_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        message_id TEXT,
        provider_type TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'chat',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_usage_created_at
        ON chat_usage_events(created_at);

      CREATE INDEX IF NOT EXISTS idx_chat_usage_thread_created
        ON chat_usage_events(thread_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_chat_usage_provider_model
        ON chat_usage_events(provider_type, model);
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS chat_usage_events;');
  },
};
