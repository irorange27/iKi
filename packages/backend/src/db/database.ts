import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { initializeMigrations } from './migration';
import { createLogger } from '@iki/backend/logger';
import { getUserDataPath } from '../platform';

export type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint };

export type SqliteStatement = {
  run: (...params: unknown[]) => SqliteRunResult;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
};

export type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  transaction: <TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult
  ) => (...args: TArgs) => TResult;
  close: () => void;
};

let db: SqliteDatabase | null = null;
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

const initCoreTables = (database: SqliteDatabase) => {
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

// node:sqlite rejects named-parameter objects carrying keys the statement never
// uses (better-sqlite3 ignored them), so object params are filtered down to the
// names actually present in the SQL text.
const NAMED_PARAM_PATTERN = /[@:$][A-Za-z_][A-Za-z0-9_]*/g;

const collectNamedParams = (sql: string): Set<string> | null => {
  const stripped = sql
    .replace(/'(?:[^']|'')*'/g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const names = stripped.match(NAMED_PARAM_PATTERN);
  if (!names || names.length === 0) return null;
  return new Set(names.map(name => name.slice(1)));
};

const normalizeBindParams = (sql: string, params: unknown[]): unknown[] => {
  if (params.length !== 1 || typeof params[0] !== 'object' || params[0] === null) return params;
  const names = collectNamedParams(sql);
  if (!names) return params;

  const source = params[0] as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (names.has(key) || names.has(key.replace(/^[@:$]/, ''))) filtered[key] = value;
  }
  return [filtered];
};

const wrapStatement = (
  sql: string,
  statement: {
    run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  }
): SqliteStatement => ({
  // Default (non-bigint) read mode always returns numbers here.
  run: (...params: unknown[]) => statement.run(...normalizeBindParams(sql, params)) as SqliteRunResult,
  get: (...params: unknown[]) => statement.get(...normalizeBindParams(sql, params)),
  all: (...params: unknown[]) => statement.all(...normalizeBindParams(sql, params)),
});

const wrapDatabase = (raw: DatabaseSync): SqliteDatabase => ({
  exec: sql => raw.exec(sql),
  prepare: sql => wrapStatement(sql, raw.prepare(sql)),
  transaction:
    <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) =>
    (...args: TArgs): TResult => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  close: () => raw.close(),
});

export const initializeDatabase = (options?: { dbPath?: string }) => {
  if (options?.dbPath) {
    dbPathOverride = options.dbPath;
  }
  if (initialized && db) return db;
  if (initializing && db) return db;

  initializing = true;
  const dbPath = resolveDbPath();
  db = wrapDatabase(new DatabaseSync(dbPath));
  initCoreTables(db);
  initialized = true;
  initializeMigrations();
  initializing = false;
  return db;
};

export const getDb = (): SqliteDatabase => {
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
