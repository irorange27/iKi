import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const MEMORY_TABLES = ['memory_short', 'memory_long', 'emotion_events', 'affect_states'];

const migration: Migration = {
  name: '005_drop_memory_and_affect',
  up: (db: SqliteDatabase) => {
    for (const table of MEMORY_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
