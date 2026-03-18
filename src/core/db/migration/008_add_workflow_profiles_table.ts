import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '008_add_workflow_profiles_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS workflow_profiles (
        thread_id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS workflow_profiles;');
  },
};
