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

import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';

import { getUserDataPath } from '@iki/core/platform';
import { commitRows, readRows, setDefaultStoreRootResolver, setStoreRoot, storeRoot } from './collection';

let pathOverride: string | null = null;

const resolveStoreRoot = (): string => {
  const fromPath = (): string | null => {
    if (pathOverride && pathOverride.trim()) return path.dirname(pathOverride.trim());
    const envPath = process.env.IKI_DB_PATH;
    if (typeof envPath === 'string' && envPath.trim()) return path.dirname(envPath.trim());
    return null;
  };
  const resolved = fromPath() ?? getUserDataPath();
  // Never write a relative store next to the process cwd (a test that mocks the
  // user-data path to '' would otherwise litter the repo). Fall back to tmp.
  return path.isAbsolute(resolved) ? resolved : path.join(os.tmpdir(), '.iki');
};

const STARTER_MODELS_TOML = `# iKi provider & model declarations
# Example:
#
# [providers.local]
# name = "Local Gateway"
# type = "openai-compatible"
# apiKey = "your-api-key"
# baseUrl = "http://127.0.0.1:3425/v1"
# models = ["workbuddy/hy4flash-free"]
# availableModels = ["workbuddy/hy4flash-free"]
# enabled = true
`;

const STARTER_SETTINGS_TOML = `# iKi user settings (overrides system defaults)
#
# [general]
# language = "zh"
# theme = "dark"
`;

const ensureHomeScaffold = (dir: string): void => {
  if (!dir) return;
  for (const sub of ['sessions', 'skills', 'state', 'profiles']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  const modelsFile = path.join(dir, 'models.toml');
  if (!fs.existsSync(modelsFile)) {
    fs.writeFileSync(modelsFile, STARTER_MODELS_TOML, { encoding: 'utf8', mode: 0o600 });
  }
  const settingsFile = path.join(dir, SETTINGS_FILE);
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, STARTER_SETTINGS_TOML, 'utf8');
  }
};

// The desktop app never calls initializeDatabase; the store resolves its directory
// lazily on first use instead.
setDefaultStoreRootResolver(() => {
  const dir = resolveStoreRoot();
  ensureHomeScaffold(dir);
  return dir;
});

export const initializeDatabase = (options?: { dbPath?: string }): void => {
  if (options?.dbPath) pathOverride = options.dbPath;
  const dir = resolveStoreRoot();
  setStoreRoot(dir);
  ensureHomeScaffold(dir);
};

/** Dropping the in-memory cache is the whole "close" operation. */
export const closeDatabase = (): void => {
  setStoreRoot(resolveStoreRoot());
};

export const getStorePath = (): string => storeRoot();

const SETTINGS_FILE = 'settings.toml';

const settingsTomlPath = (): string => path.join(storeRoot(), SETTINGS_FILE);

const stripNullish = (value: unknown): unknown => {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map(stripNullish).filter(item => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = stripNullish(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
};

const readSettingsToml = (): unknown => {
  const file = settingsTomlPath();
  if (!fs.existsSync(file)) return null;
  try {
    return parseToml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof TomlError) return null;
    throw error;
  }
};

const writeSettingsToml = (value: unknown): void => {
  const file = settingsTomlPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cleaned = stripNullish(value);
  const record =
    cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
      ? (cleaned as Record<string, unknown>)
      : {};
  fs.writeFileSync(file, stringifyToml(record), 'utf8');
};

export const getConfig = (key: string): unknown => {
  if (key === 'app_config') {
    const fromToml = readSettingsToml();
    if (fromToml !== null) return fromToml;
  }
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
  if (key === 'app_config') {
    writeSettingsToml(value);
    return;
  }
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
