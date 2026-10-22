import type { SqliteDatabase } from '../sqlite';
import {
  isMigrationExecuted,
  markMigrationExecuted,
  runMigrations,
  type Migration,
} from './runner';
import { migration as baseline } from './001_baseline';
import { migration as dropLegacyTables } from './002_drop_legacy_tables';

export const registeredMigrations: Migration[] = [baseline, dropLegacyTables];

export const initializeMigrations = (db: SqliteDatabase) => {

  const hasPreBaselineSchema = Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('config', 'providers', 'thread_run_locks', 'session_events', 'migrations') LIMIT 1"
      )
      .get()
  );

  if (hasPreBaselineSchema && !isMigrationExecuted(db, baseline.name)) {
    runMigrations(db, []);
    markMigrationExecuted(db, baseline.name);
  }

  runMigrations(db, registeredMigrations);
};
