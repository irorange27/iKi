/**
 * Store bootstrap. There is no database engine: initialization just picks the
 * directory where collections and the append-only session logs live.
 *
 * `initializeDatabase({ dbPath })` keeps its old name and shape because ~35 test
 * fixtures and the composition root call it; the path is interpreted as a directory
 * marker (its dirname is the store root). No schema, no migrations, no connection.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getUserDataPath } from '../platform';
import { commitRows, readRows, setDefaultStoreRootResolver, setStoreRoot, storeRoot } from './collection';

let pathOverride: string | null = null;

const resolveStoreRoot = (): string => {
  const fromPath = (): string | null => {
    if (pathOverride && pathOverride.trim()) return path.dirname(pathOverride.trim());
    const envPath = process.env.IKI_DB_PATH;
    if (typeof envPath === 'string' && envPath.trim()) return path.dirname(envPath.trim());
    return null;
  };
  const resolved = fromPath() ?? path.join(getUserDataPath(), 'iki-store');
  // Never write a relative store next to the process cwd (a test that mocks the
  // user-data path to '' would otherwise litter the repo). Fall back to tmp.
  return path.isAbsolute(resolved) ? resolved : path.join(os.tmpdir(), 'iki-store');
};

// The desktop app never calls initializeDatabase; the store resolves its directory
// lazily on first use instead.
setDefaultStoreRootResolver(resolveStoreRoot);

export const initializeDatabase = (options?: { dbPath?: string }): void => {
  if (options?.dbPath) pathOverride = options.dbPath;
  setStoreRoot(resolveStoreRoot());
};

/** Dropping the in-memory cache is the whole "close" operation. */
export const closeDatabase = (): void => {
  setStoreRoot(resolveStoreRoot());
};

export const getStorePath = (): string => storeRoot();

export const getConfig = (key: string): unknown => {
  const rows = readRows<{ key: string; value: string }>('config');
  const row = rows.find(entry => entry.key === key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return null;
  }
};

export const setConfig = (key: string, value: unknown): void => {
  const rows = readRows<{ key: string; value: string }>('config');
  const next = rows.filter(entry => entry.key !== key);
  next.push({ key, value: JSON.stringify(value) });
  commitRows('config', next);
};

/** Legacy JSON config import. Reads a file, if present, into the config collection. */
export const migrateFromJson = (jsonPath: string, key: string): void => {
  if (getConfig(key) !== null) return;
  try {
    if (!fs.existsSync(jsonPath)) return;
    const parsed: unknown = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    setConfig(key, parsed);
  } catch {
    // A malformed legacy file is not worth blocking startup for.
  }
};
