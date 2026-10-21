import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const DEAD_TABLES = ['agent_run_checkpoints', 'tool_allowlist'];

const migration: Migration = {
  name: '007_drop_dead_tables',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
