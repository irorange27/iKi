import type { SqliteDatabase } from '../sqlite';
import {
  isMigrationExecuted,
  markMigrationExecuted,
  runMigrations,
  type Migration,
} from './runner';
import { migration as baseline } from './001_baseline';
import { migration as renameChatToolApprovals } from './002_rename_chat_tool_approvals';
import { migration as approvalSessionWorkspaceSelection } from './003_approval_session_workspace_selection';
import { migration as approvalSessionPlan } from './004_approval_session_plan';
import { migration as dropMemoryAndAffect } from './005_drop_memory_and_affect';
import { migration as dropThreadContext } from './006_drop_thread_context';
import { migration as dropDeadTables } from './007_drop_dead_tables';

// Forward-only migrations after the baseline. Add new ones above 001 in name
// order (002_*, 003_*, …) — runMigrations sorts by name. Tables introduced
// after the squash are bootstrap-created in database.ts (initCoreTables), not
// by migrations: post-baseline migrations must not emit CREATE TABLE.
export const registeredMigrations: Migration[] = [
  baseline,
  renameChatToolApprovals,
  approvalSessionWorkspaceSelection,
  approvalSessionPlan,
  dropMemoryAndAffect,
  dropThreadContext,
  dropDeadTables,
];

export const initializeMigrations = (db: SqliteDatabase) => {
  // Databases created before the migration squash already carry the full
  // schema: detect any pre-existing user table and mark the baseline as
  // applied so they open unchanged. Fresh databases run the baseline to
  // create the schema from scratch. config/providers/migrations are excluded
  // because database.ts bootstrap-creates them before migrations run.
  // hasPreBaselineSchema detection must ignore every table initCoreTables
  // bootstrap-creates (config, providers, thread_run_locks, session_events,
  // migrations) or a fresh database gets misread as pre-squash and skips the
  // baseline.
  const hasPreBaselineSchema = Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('config', 'providers', 'thread_run_locks', 'session_events', 'migrations') LIMIT 1"
      )
      .get()
  );

  if (hasPreBaselineSchema && !isMigrationExecuted(db, baseline.name)) {
    runMigrations(db, []); // ensures the migrations bookkeeping table exists
    markMigrationExecuted(db, baseline.name);
  }

  runMigrations(db, registeredMigrations);
};
