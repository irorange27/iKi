import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '009_add_affect_states_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS affect_states (
        thread_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_affect_states_updated ON affect_states(updated_at);
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS affect_states;');
  },
};
