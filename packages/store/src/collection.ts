/**
 * Prototype-grade storage: one JSON file per collection, held in memory.
 *
 * There is no SQL, no schema and no migration. Every collection is a plain array
 * of records; reads are array operations, writes replace the whole array. The data
 * volumes here are tiny (tens of threads, providers, awaiters), so a full rewrite
 * on each write is cheaper than maintaining a query engine — and this is a
 * prototype with no data worth preserving.
 *
 * The session log is NOT a collection: it is an append-only JSONL stream, see
 * session_log_store.ts.
 */

import fs from 'node:fs';
import path from 'node:path';

let root = '';
let defaultRootResolver: (() => string) | null = null;

export const setStoreRoot = (dir: string): void => {
  root = dir;
  if (dir) fs.mkdirSync(dir, { recursive: true });
};

/** database.ts registers how to find the default store directory, so this module
 * stays free of platform imports. Called lazily on first use when nothing has
 * initialised the store yet (the desktop app never calls initializeDatabase). */
export const setDefaultStoreRootResolver = (resolve: () => string): void => {
  defaultRootResolver = resolve;
};

export const storeRoot = (): string => {
  if (!root && defaultRootResolver) {
    root = defaultRootResolver();
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
};

const fileOf = (name: string): string => path.join(storeRoot(), `${name}.json`);

/**
 * Read the whole collection from disk. No in-process cache: the files are the
 * source of truth and another writer (a test harness, an external tool) may have
 * changed them, so a cached array would go stale and be written back over the
 * other writer's change. Collections are tiny; reading a file is cheap.
 */
export const readRows = <T>(name: string): T[] => {
  const file = fileOf(name);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as T[]).slice() : [];
  } catch {
    // A half-written file is treated as empty; the next commit repairs it.
    return [];
  }
};

export const commitRows = <T>(name: string, rows: readonly T[]): void => {
  const file = fileOf(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows.slice()));
};

/** Replace one record by a key, or append it. Returns the new collection. */
export const upsertRow = <T>(
  name: string,
  key: keyof T,
  value: T[keyof T],
  row: T
): T[] => {
  const rows = readRows<T>(name);
  const index = rows.findIndex(existing => existing[key] === value);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
  commitRows(name, rows);
  return rows;
};

/** Apply a partial patch to one row by key. Returns the number of rows changed. */
export const patchRow = <T extends object>(
  name: string,
  keyField: string,
  keyValue: unknown,
  patch: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  touchUpdatedAt = true
): number => {
  const rows = readRows<T>(name);
  const index = rows.findIndex(row => (row as Record<string, unknown>)[keyField] === keyValue);
  if (index < 0) return 0;
  const current = rows[index] as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  for (const [field, value] of Object.entries(patch)) {
    if (!allowed.has(field)) continue;
    next[field] = value;
  }
  if (touchUpdatedAt) next.updated_at = new Date().toISOString();
  rows[index] = next as T;
  commitRows(name, rows);
  return 1;
};

/** Delete rows matching a key. Returns the number removed. */
export const removeRow = <T extends object>(
  name: string,
  keyField: string,
  keyValue: unknown
): number => {
  const rows = readRows<T>(name);
  const kept = rows.filter(row => (row as Record<string, unknown>)[keyField] !== keyValue);
  if (kept.length === rows.length) return 0;
  commitRows(name, kept);
  return rows.length - kept.length;
};
