import db from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '002_add_workspaces_table',
  up: () => {
    // Create workspaces table
    db.exec(`
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                is_temporary INTEGER NOT NULL DEFAULT 0,
                show_in_list INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `);
  },
  down: () => {
    // Drop workspaces table
    db.exec('DROP TABLE IF EXISTS workspaces;');
  },
};
