import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

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
