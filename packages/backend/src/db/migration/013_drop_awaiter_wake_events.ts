import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const DEAD_TABLES = ['awaiter_wake_events'];

const migration: Migration = {
  name: '013_drop_awaiter_wake_events',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
