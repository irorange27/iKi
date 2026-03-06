import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import { initializeMigrations } from './migration';

const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'iKi_v0.db');

const db = new Database(dbPath);

// Initialize core tables (these should always exist)
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS "providers"(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    api_key TEXT NOT NULL,
    models TEXT NOT NULL,
    base_url TEXT,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    available_models TEXT NOT NULL DEFAULT '[]',
    api_version TEXT,
    is_response_api INTEGER DEFAULT 0,
    acp_command TEXT,
    acp_args TEXT,
    acp_mcp_server_ids TEXT,
    acp_auth_method_id TEXT,
    acp_api_provider_id TEXT,
    acp_model_mapping TEXT
  );
`);

// Run migrations to create/update other tables
initializeMigrations();

export const getConfig = (key: string): unknown => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch (e) {
      console.error('Failed to parse config value:', e);
      return null;
    }
  }
  return null;
};

export const setConfig = (key: string, value: unknown) => {
  const statement = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  statement.run(key, JSON.stringify(value));
};

export const migrateFromJson = (jsonPath: string, key: string) => {
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      setConfig(key, data);
      // Optional: Rename or delete the old file
      fs.renameSync(jsonPath, jsonPath + '.bak');
      console.log(`Migrated config from ${jsonPath} to SQLite`);
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }
};

export default db;
