import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

const DEAD_TABLES = ['chat_thread_todos', 'todo_items', 'todo_lists'];

const migration: Migration = {
  name: '014_drop_todo_tables',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
