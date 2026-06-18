import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '040_add_clipboard_snapshots_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS clipboard_snapshots (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        content_preview TEXT NOT NULL,
        content_length INTEGER NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'text/plain',
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clipboard_snapshots_captured
        ON clipboard_snapshots(captured_at DESC);

      CREATE INDEX IF NOT EXISTS idx_clipboard_snapshots_hash
        ON clipboard_snapshots(content_hash, captured_at DESC);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS clipboard_snapshots;
    `);
  },
};
