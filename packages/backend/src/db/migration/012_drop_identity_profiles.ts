import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const DEAD_TABLES = ['identity_profiles'];

const migration: Migration = {
  name: '012_drop_identity_profiles',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
