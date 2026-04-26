import Database = require('better-sqlite3');
import path from 'path';
import fs from 'fs';
import { initializeMigrations } from './migration';
import { createLogger } from '../logger';
import { getUserDataPath } from '../platform';

let db: Database.Database | null = null;
let initialized = false;
let initializing = false;
let dbPathOverride: string | null = null;
const databaseLogger = createLogger({ module: 'database' });

const resolveDbPath = (): string => {
  if (dbPathOverride && dbPathOverride.trim()) return dbPathOverride.trim();
  const envPath = process.env.IKI_DB_PATH;
  if (typeof envPath === 'string' && envPath.trim()) return envPath.trim();
  return path.join(getUserDataPath(), 'iKi_v0.db');
};

const initCoreTables = (database: Database.Database) => {
  database.exec(`
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
      model_options TEXT NOT NULL DEFAULT '{}',
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
};

export const initializeDatabase = (options?: { dbPath?: string }) => {
  if (options?.dbPath) {
    dbPathOverride = options.dbPath;
  }
  if (initialized && db) return db;
  if (initializing && db) return db;

  initializing = true;
  const dbPath = resolveDbPath();
  db = new Database(dbPath);
  initCoreTables(db);
  initialized = true;
  initializeMigrations();
  initializing = false;
  return db;
};

export const getDb = (): Database.Database => {
  if (!initialized || !db) {
    return initializeDatabase();
  }
  return db;
};

export const closeDatabase = () => {
  if (!db) return;
  try {
    db.close();
  } catch (error) {
    databaseLogger.warn('Failed to close database', error);
  } finally {
    db = null;
    initialized = false;
    initializing = false;
  }
};

export const getConfig = (key: string): unknown => {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch (e) {
      databaseLogger.error('Failed to parse config value', e);
      return null;
    }
  }
  return null;
};

export const setConfig = (key: string, value: unknown) => {
  const statement = getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  statement.run(key, JSON.stringify(value));
};

export const migrateFromJson = (jsonPath: string, key: string) => {
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      setConfig(key, data);
      // Optional: Rename or delete the old file
      fs.renameSync(jsonPath, jsonPath + '.bak');
      databaseLogger.event({
        level: 'info',
        event: 'config.migrate',
        outcome: 'succeeded',
        message: 'Migrated config from JSON to SQLite',
        data: {
          json_path: jsonPath,
          config_key: key,
        },
      });
    } catch (e) {
      databaseLogger.event({
        level: 'error',
        event: 'config.migrate',
        outcome: 'failed',
        message: 'Failed to migrate config from JSON to SQLite',
        data: {
          json_path: jsonPath,
          config_key: key,
        },
        error: e,
      });
    }
  }
};
