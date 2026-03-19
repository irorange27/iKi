import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '009_add_mcp_servers_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args TEXT,
        cwd TEXT,
        env TEXT,
        base_url TEXT,
        headers TEXT,
        auth_ref TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        tool_allowlist TEXT,
        approval_mode TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_connected_at TEXT,
        last_error TEXT
      );
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS mcp_servers;');
  },
};
