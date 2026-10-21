import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// `chat_thread_context` was the storage half of the rolling-thread-summary
// projection. Its reader module (`db/thread_context.ts` + the schema-ensure
// helper) had no production caller left — only its own unit test and a vi.mock
// in an unrelated suite kept it alive — so both the module and the table are
// now dead code.
//
// Kept as its OWN migration rather than folded into 005: that one is the
// memory/affect removal, and a database that already ran 005 must still lose
// this table. Migration names are the replay unit, so mixing the two would
// strand every already-migrated database with an orphan table.
const migration: Migration = {
  name: '006_drop_thread_context',
  up: (db: SqliteDatabase) => {
    db.exec('DROP TABLE IF EXISTS chat_thread_context');
  },
};

export { migration };
