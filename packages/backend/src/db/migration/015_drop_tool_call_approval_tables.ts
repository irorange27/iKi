import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// A paused approval is memory-only now: the process that asked owns the
// decision, and a crash ends the turn instead of resuming it. These tables
// existed solely to rebuild a paused session after a restart.
const DEAD_TABLES = ['tool_call_approvals', 'tool_call_approval_sessions'];

const migration: Migration = {
  name: '015_drop_tool_call_approval_tables',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
