import { getDb } from '../database';
import {
  isMigrationExecuted,
  markMigrationExecuted,
  runMigrations,
  type Migration,
} from './runner';
import { migration as baseline } from './001_baseline';

// Forward-only migrations after the baseline. Add new ones above 001 in name
// order (002_*, 003_*, …) — runMigrations sorts by name.
export const registeredMigrations: Migration[] = [baseline];

export const initializeMigrations = () => {
  // Databases created before the migration squash already carry the full
  // schema: detect any pre-existing user table and mark the baseline as
  // applied so they open unchanged. Fresh databases run the baseline to
  // create the schema from scratch. config/providers/migrations are excluded
  // because database.ts bootstrap-creates them before migrations run.
  const hasPreBaselineSchema = Boolean(
    getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('config', 'providers', 'migrations') LIMIT 1"
      )
      .get()
  );

  if (hasPreBaselineSchema && !isMigrationExecuted(baseline.name)) {
    runMigrations([]); // ensures the migrations bookkeeping table exists
    markMigrationExecuted(baseline.name);
  }

  runMigrations(registeredMigrations);
};
