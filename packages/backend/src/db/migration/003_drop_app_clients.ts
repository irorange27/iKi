import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// app_clients was baseline-created but no db module ever queried it in
// production (the module was removed unused). New 003 entry because databases
// that already ran 002 never re-read its drop list.
const migration: Migration = {
  name: '003_drop_app_clients',
  up: (db: SqliteDatabase) => {
    db.exec('DROP TABLE IF EXISTS app_clients');
  },
};

export { migration };
