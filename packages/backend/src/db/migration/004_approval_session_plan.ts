import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// The typed ExecutionPlan is the authority an approval resume runs under
// (stage B): the session row now carries the full plan snapshot as JSON, so
// a restart-recovered resume restores every field — budgets, reasoning
// effort, autonomy, world binding — instead of re-deriving a lossy subset
// from the per-column fields. Those columns stay as the legacy read path for
// rows written before this migration.
const migration: Migration = {
  name: '004_approval_session_plan',
  up: (db: SqliteDatabase) => {
    const columns = db
      .prepare("PRAGMA table_info('tool_call_approval_sessions')")
      .all() as Array<{ name: string }>;
    if (columns.some(column => column.name === 'plan_json')) return;
    db.exec(
      'ALTER TABLE tool_call_approval_sessions ADD COLUMN plan_json TEXT DEFAULT NULL'
    );
  },
};

export { migration };
