import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// The continuity subsystem is gone: three tables, a 544-line db module, a
// desktop service, a types file, and three injected ports.
//
// What it actually did: nine regular expressions scanned each persisted
// assistant message for phrases like "my name is X", "call me Y", "I prefer
// Z" (and the Chinese equivalents 我的名字是 / 叫我 / 我更喜欢 / 请记住 / 记住).
// A match became a `continuity_items` row, which was later retrieved by
// keyword search and pasted into the system prompt as remembered facts.
//
// Why it is removed rather than fixed:
//  - No UI could create, list, edit or delete an entry. The renderer had zero
//    references; the only writer was the regex pass and the only reader was
//    the prompt injection, so the user could neither see nor correct what the
//    model was told about them.
//  - "Continuity" was a regex, not memory. A sentence that did not match a
//    pattern was silently not remembered; a sentence that did match became a
//    permanent fact with `confidence: 1` and `status: 'confirmed'`.
//  - It wrote on every persisted message, so the cost was paid on every turn
//    for a feature with no surface.
//
// A real memory feature needs a place to review and correct what is stored.
// Until that exists, storing inferred facts about the user and injecting them
// unverified is worse than storing nothing.
//
// Order matters inside this migration only in that evidence references items;
// both are dropped, so the order is irrelevant. `DROP TABLE IF EXISTS` also
// drops each table's indexes.
const DEAD_TABLES = ['continuity_evidence', 'continuity_items', 'assistant_profiles'];

const migration: Migration = {
  name: '011_drop_continuity',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
