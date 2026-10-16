// Keep the default database out of the developer's real `~/.iki`.
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
//
// Setup files re-run per test file, and vitest gives each file its own worker
// process, so every file gets a distinct directory. The assertion runs in a
// `beforeEach` rather than once at import because several suites
// (`delete process.env.IKI_USER_DATA_PATH` in a hook) deliberately unset the
// variable; re-asserting per test keeps those files isolated too instead of
// letting them fall back to the real home directory.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach } from 'vitest';

const scratchUserDataPath = mkdtempSync(join(tmpdir(), 'iki-test-user-data-'));

beforeEach(() => {
  // `??=` only fills undefined: a file that deleted the variable in a
  // previous hook would otherwise keep the real home-directory fallback.
  process.env.IKI_USER_DATA_PATH ??= scratchUserDataPath;
});
