import type { SqliteDatabase } from '../sqlite';
import { createLogger } from '@iki/backend/logger';

const migrationLogger = createLogger({ module: 'db_migration_runner' });

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
  up: (db: SqliteDatabase) => void;
}

export const isMigrationExecuted = (db: SqliteDatabase, name: string): boolean =>
  Boolean(db.prepare('SELECT name FROM migrations WHERE name = ?').get(name));

export const markMigrationExecuted = (db: SqliteDatabase, name: string) => {
  db.prepare('INSERT INTO migrations (name, executed_at) VALUES (?, ?)').run(
    name,
    new Date().toISOString()
  );
};

const runMigration = (db: SqliteDatabase, migration: Migration) => {
  if (isMigrationExecuted(db, migration.name)) return;

  try {
    migrationLogger.event({
      level: 'info',
      event: 'db.migration',
      outcome: 'started',
      message: 'Running migration',
      data: { migration_name: migration.name },
    });
    migration.up(db);
    markMigrationExecuted(db, migration.name);
  } catch (error) {
    migrationLogger.event({
      level: 'error',
      event: 'db.migration',
      outcome: 'failed',
      message: 'Migration failed',
      data: { migration_name: migration.name },
      error,
    });
    throw error;
  }
};

export const runMigrations = (db: SqliteDatabase, migrations: Migration[]) => {
  initMigrationsTable(db);

  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    runMigration(db, migration);
  }
};
