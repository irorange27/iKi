import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '007_add_emotion_events_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS emotion_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        emotion TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_emotion_events_thread ON emotion_events(thread_id);
      CREATE INDEX IF NOT EXISTS idx_emotion_events_updated ON emotion_events(updated_at);
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS emotion_events;');
  },
};
