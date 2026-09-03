import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '041_add_tool_allowlist_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS tool_allowlist (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        pattern TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  },
};
