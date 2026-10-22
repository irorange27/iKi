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

// Tables database.ts creates before migrations run. Anything else means the
// database predates the squashed baseline.
const CORE_TABLES = ['config', 'providers', 'thread_run_locks', 'session_events', 'migrations'];

const hasPreBaselineSchema = (db: SqliteDatabase): boolean => {
  const placeholders = CORE_TABLES.map(() => '?').join(', ');
  return Boolean(
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN (${placeholders}) LIMIT 1`
      )
      .get(...CORE_TABLES)
  );
};

export const initializeMigrations = (db: SqliteDatabase) => {
  // A database from before the squash already has every table the baseline
  // would create, but its older column sets fail the baseline's indexes. Record
  // the baseline as executed instead of replaying it.
  if (hasPreBaselineSchema(db)) {
    runMigrations(db, []);
    if (!isMigrationExecuted(db, baseline.name)) {
      markMigrationExecuted(db, baseline.name);
    }
  }

  runMigrations(db, registeredMigrations);
};
