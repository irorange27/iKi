import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// `clipboard_snapshots` has no owner anywhere in the tree: no reader, no
// writer, no db module, and no CREATE statement in `001_baseline.ts`. It
// exists only in databases created before the migration squash, which is why
// the baseline cannot drop it and this migration must.
//
// The columns say what it used to be (a captured clipboard history: content
// hash, preview, length, mime type, capture time). Whatever wrote it was
// removed without its table, so a fresh install never creates it and an
// upgraded one keeps a table nothing can address. Leaving it is not free: it
// carries two indexes (`idx_clipboard_snapshots_captured`,
// `idx_clipboard_snapshots_hash`) that SQLite still has to keep consistent on
// every write to that table — writes that never happen, so the cost is latent
// rather than measured, but the schema lie is real: a `SELECT *` archaeology
// would read this as live state.
//
// Its own migration, not folded into 007: a database may have run 007 already
// (007's subject is two DIFFERENT tables), and migration names are the replay
// unit. Folding would strand every already-migrated database with this table.
//
// `DROP TABLE IF EXISTS` is idempotent, and SQLite drops the table's indexes
// with it — the two `idx_clipboard_snapshots_*` need no separate DROP. A
// database that never had the table (every fresh install) is a no-op.
const DEAD_TABLES = ['clipboard_snapshots'];

const migration: Migration = {
  name: '008_drop_clipboard_snapshots',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
