// Keep the database out of the developer's real `~/.iki`.
//
// `resolveDbPath()` (db/database.ts) falls back to
// `path.join(getUserDataPath(), 'iKi_v0.db')`, and `getUserDataPath()`
// (platform.ts) falls back to `path.join(os.homedir(), '.iki')`. Any test
// that opens a database WITHOUT an explicit `dbPath` therefore writes to the
// real user-data directory — three thread_session integration suites
// (chat_streaming, message_send, chat_approval_resume_autonomous) do exactly
// that, so they read and write the live `~/.iki/iKi_v0.db`. On a machine or
// sandbox where that path is read-only they fail with
// `attempt to write a readonly database`, and where it is writable they
// silently depend on (and mutate) developer state.
//
// Point the default at a scratch directory instead. Tests that pass an
// explicit `dbPath` are unaffected — the override only changes the fallback,
// and `closeDatabase()` clears any per-open override (issue #152), so this
// cannot leak across files.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.IKI_USER_DATA_PATH ??= mkdtempSync(join(tmpdir(), 'iki-test-user-data-'));
