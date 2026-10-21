import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const migration: Migration = {
  name: '006_drop_thread_context',
  up: (db: SqliteDatabase) => {
    db.exec('DROP TABLE IF EXISTS chat_thread_context');
  },
};

export { migration };
