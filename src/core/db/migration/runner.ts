import { getDb } from '../database';

// Migration table to track executed migrations
const initMigrationsTable = () => {
  getDb().exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            executed_at TEXT NOT NULL
        );
    `);
};

export interface Migration {
  name: string;
  aliases?: string[];
  up: () => void;
  down?: () => void;
}

const findExecutedMigrationName = (migration: Pick<Migration, 'name' | 'aliases'>): string | null => {
  const candidates = [migration.name, ...(migration.aliases ?? [])];
  const placeholders = candidates.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT name FROM migrations WHERE name IN (${placeholders})`)
    .all(...candidates) as Array<{ name: string }>;

  if (rows.length === 0) return null;

  const executedNames = new Set(rows.map(row => row.name));
  for (const candidate of candidates) {
    if (executedNames.has(candidate)) {
      return candidate;
    }
  }

  return null;
};

// Mark a migration as executed
export const markMigrationExecuted = (name: string) => {
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO migrations (name, executed_at) VALUES (?, ?)').run(name, now);
};

const renameExecutedMigration = (fromName: string, toName: string) => {
  if (fromName === toName) return;
  getDb().prepare('UPDATE migrations SET name = ? WHERE name = ?').run(toName, fromName);
};

// Check if a migration has been executed
export const isMigrationExecuted = (name: string, aliases: string[] = []): boolean =>
  Boolean(findExecutedMigrationName({ name, aliases }));

// Run a migration
export const runMigration = (migration: Migration) => {
  const executedName = findExecutedMigrationName(migration);
  if (executedName) {
    if (executedName !== migration.name) {
      console.log(`Normalizing migration record: ${executedName} -> ${migration.name}`);
      renameExecutedMigration(executedName, migration.name);
    }
    console.log(`Migration ${migration.name} already executed, skipping...`);
    return;
  }

  try {
    console.log(`Running migration: ${migration.name}`);
    migration.up();
    markMigrationExecuted(migration.name);
    console.log(`Migration ${migration.name} completed successfully`);
  } catch (error) {
    console.error(`Migration ${migration.name} failed:`, error);
    throw error;
  }
};

// Run all migrations
export const runMigrations = (migrations: Migration[]) => {
  initMigrationsTable();

  // Sort migrations by name to ensure consistent execution order
  const sortedMigrations = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

  for (const migration of sortedMigrations) {
    runMigration(migration);
  }
};

// Get all executed migrations
export const getExecutedMigrations = (): string[] => {
  initMigrationsTable();
  const rows = getDb().prepare('SELECT name FROM migrations ORDER BY executed_at').all() as {
    name: string;
  }[];
  return rows.map(row => row.name);
};
