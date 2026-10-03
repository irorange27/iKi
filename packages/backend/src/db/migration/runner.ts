import type { SqliteDatabase } from '../sqlite';
import { createLogger } from '@iki/backend/logger';

const migrationLogger = createLogger({ module: 'db_migration_runner' });

// The database handle flows down from initializeDatabase: migration modules
// never import the getDb singleton (arch rule db-migration-above-database) —
// importing it is the module-level cycle this file used to sit in.
// Migration table to track executed migrations
const initMigrationsTable = (db: SqliteDatabase) => {
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
  aliases?: string[];
  up: (db: SqliteDatabase) => void;
  down?: (db: SqliteDatabase) => void;
}

const findExecutedMigrationName = (
  db: SqliteDatabase,
  migration: Pick<Migration, 'name' | 'aliases'>
): string | null => {
  const candidates = [migration.name, ...(migration.aliases ?? [])];
  const placeholders = candidates.map(() => '?').join(', ');
  const rows = db
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
export const markMigrationExecuted = (db: SqliteDatabase, name: string) => {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO migrations (name, executed_at) VALUES (?, ?)').run(name, now);
};

const renameExecutedMigration = (db: SqliteDatabase, fromName: string, toName: string) => {
  if (fromName === toName) return;
  db.prepare('UPDATE migrations SET name = ? WHERE name = ?').run(toName, fromName);
};

// Check if a migration has been executed
export const isMigrationExecuted = (
  db: SqliteDatabase,
  name: string,
  aliases: string[] = []
): boolean => Boolean(findExecutedMigrationName(db, { name, aliases }));

// Run a migration
export const runMigration = (db: SqliteDatabase, migration: Migration) => {
  const executedName = findExecutedMigrationName(db, migration);
  if (executedName) {
    if (executedName !== migration.name) {
      migrationLogger.event({
        level: 'info',
        event: 'db.migration',
        outcome: 'degraded',
        message: 'Normalized legacy migration name',
        data: {
          from_name: executedName,
          to_name: migration.name,
        },
      });
      renameExecutedMigration(db, executedName, migration.name);
    }
    migrationLogger.event({
      level: 'info',
      event: 'db.migration',
      outcome: 'skipped',
      message: 'Migration already executed',
      data: {
        migration_name: migration.name,
      },
    });
    return;
  }

  try {
    migrationLogger.event({
      level: 'info',
      event: 'db.migration',
      outcome: 'started',
      message: 'Running migration',
      data: {
        migration_name: migration.name,
      },
    });
    migration.up(db);
    markMigrationExecuted(db, migration.name);
    migrationLogger.event({
      level: 'info',
      event: 'db.migration',
      outcome: 'succeeded',
      message: 'Migration completed successfully',
      data: {
        migration_name: migration.name,
      },
    });
  } catch (error) {
    migrationLogger.event({
      level: 'error',
      event: 'db.migration',
      outcome: 'failed',
      message: 'Migration failed',
      data: {
        migration_name: migration.name,
      },
      error,
    });
    throw error;
  }
};

// Run all migrations
export const runMigrations = (db: SqliteDatabase, migrations: Migration[]) => {
  initMigrationsTable(db);

  // Sort migrations by name to ensure consistent execution order
  const sortedMigrations = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

  for (const migration of sortedMigrations) {
    runMigration(db, migration);
  }
};

// Get all executed migrations
export const getExecutedMigrations = (db: SqliteDatabase): string[] => {
  initMigrationsTable(db);
  const rows = db.prepare('SELECT name FROM migrations ORDER BY executed_at').all() as {
    name: string;
  }[];
  return rows.map(row => row.name);
};
