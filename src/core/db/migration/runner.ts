import db from '../database';

// Migration table to track executed migrations
const initMigrationsTable = () => {
  db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            executed_at TEXT NOT NULL
        );
    `);
};

export interface Migration {
  name: string;
  up: () => void;
  down?: () => void;
}

// Check if a migration has been executed
export const isMigrationExecuted = (name: string): boolean => {
  const row = db.prepare('SELECT name FROM migrations WHERE name = ?').get(name) as
    | { name: string }
    | undefined;
  return !!row;
};

// Mark a migration as executed
export const markMigrationExecuted = (name: string) => {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO migrations (name, executed_at) VALUES (?, ?)').run(name, now);
};

// Run a migration
export const runMigration = (migration: Migration) => {
  if (isMigrationExecuted(migration.name)) {
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
  const rows = db.prepare('SELECT name FROM migrations ORDER BY executed_at').all() as {
    name: string;
  }[];
  return rows.map(row => row.name);
};
