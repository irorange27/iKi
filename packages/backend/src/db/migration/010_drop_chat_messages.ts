import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// `chat_messages` is gone (ADR 011). It was a mutable row table holding the
// same conversation the session log already recorded, which made it a second
// authority: two stores that could disagree, with the log nominally the truth
// (ADR 008) and the table what every render actually read.
//
// What replaced it:
//  - reads project the log (`turn_prep/persistence.ts` listMessages/getMessage,
//    built on `findMessageEvent` in `db/session_events.ts`);
//  - writes append a fact (INPUT_ACCEPTED / MODEL_OUTPUT_COMMITTED);
//  - the startup pass that REWROTE unfinished tool parts is deleted — the
//    repair already happens at read time in `toModelInputMessages`
//    (`repairInterruptedTools`), so nothing needs patching;
//  - history truncation records a `messages_truncated` fact instead of
//    DELETEing a tail.
//
// The table is dropped rather than left behind: an unused table with two
// indexes is exactly the archaeology trap this project keeps hitting.
//
// Guarded on existence like 008/009 — `DROP TABLE IF EXISTS` already covers
// the absent case, but the guard makes the intent explicit and keeps this
// migration harmless on a database that never ran the baseline.
const DEAD_TABLES = ['chat_messages'];

const migration: Migration = {
  name: '010_drop_chat_messages',
  up: (db: SqliteDatabase) => {
    for (const table of DEAD_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
