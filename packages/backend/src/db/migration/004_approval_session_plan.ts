import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

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
