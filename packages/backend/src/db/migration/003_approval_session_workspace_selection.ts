import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// Approval recovery must rebind the ORIGINAL turn workspace (D30): the
// session row now carries the turn-start workspace selection snapshot, so a
// resumed execution cannot be redirected to the thread's current selection.
// Fresh and legacy databases alike add the nullable column here — the 001
// baseline table predates the field.
const migration: Migration = {
  name: '003_approval_session_workspace_selection',
  up: (db: SqliteDatabase) => {
    const columns = db
      .prepare("PRAGMA table_info('tool_call_approval_sessions')")
      .all() as Array<{ name: string }>;
    if (columns.some(column => column.name === 'workspace_selection')) return;
    db.exec(
      'ALTER TABLE tool_call_approval_sessions ADD COLUMN workspace_selection TEXT DEFAULT NULL'
    );
  },
};

export { migration };
