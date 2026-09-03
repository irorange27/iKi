# Backend Bug Audit Postmortem — April 2026

> **Path note (2026-09):** file references below use pre-monorepo paths (`src/main/…`, `src/core/…`, `src/daemon/…`). After the `packages/` restructure: `src/main` → `packages/desktop/src/main`, `src/core` → `packages/backend`, `src/daemon` → `packages/daemon`; some files were renamed or removed. The bugs and root-cause patterns are still current.

## Summary

Audit of the iKi backend (main process IPC, daemon server, core agent/tools, database/services) found ~40 issues across 4 layers, consolidated to 20 key bugs: 8 high severity, 8 medium, 4 low.

---

## High Severity (8)

### Bug #1 — `updates:install` swallows Promise return value
**File:** `src/main/ipc/updater.ts:17-19`
**Root cause:** `ipcMain.handle` handler calls `installDownloadedAppUpdate()` without `return`, so Electron never awaits the async operation. If the install fails, the error is silently swallowed rather than returned to the renderer.
**Impact:** Silent install failures; renderer cannot detect when an update installation fails.
**Fix:** Add `return` before `installDownloadedAppUpdate()`.

### Bug #2 — `ipcMain.on` callbacks can crash the main process
**File:** `src/main/ipc/window.ts:11,17,22`
**Root cause:** `ipcMain.on` (unlike `ipcMain.handle`) does not catch exceptions thrown in its callbacks. If `createSettingsWindow` or `BrowserWindow.fromWebContents` throws synchronously, the unhandled exception propagates to the Electron main process event loop and can crash the entire application.
**Impact:** Unhandled errors in window IPC handlers can crash the app. These handlers operate on renderer-supplied event senders, so a null-dereference or type error at the wrong moment is fatal.
**Fix:** Wrap each `ipcMain.on` handler body in try/catch.

### Bug #3 — Missing `ws.on('error')` handler causes crash + session leak
**File:** `src/daemon/server_ws.ts:104-107`
**Root cause:** The WebSocket `close` handler at line 104 (`ws.on('close', ...)`) cleans up session maps, but there is no `ws.on('error', ...)` handler. The `ws` library emits `'error'` events that, if unhandled, crash the Node.js process. Additionally, without an error handler that also cleans up the session maps, an error-then-close sequence may leave stale entries if the error handler doesn't clean up.
**Impact:** Unhandled WebSocket errors crash the daemon process. Leaked session map entries accumulate until OOM.
**Fix:** Add `ws.on('error', handler)` that logs the error and cleans up session maps.

### Bug #4 — Shell command injection via `exec()`
**File:** `src/core/tools/shell_tools.ts:25`
**Root cause:** Uses `child_process.exec()` (which spawns `/bin/sh -c`) with unsanitized user input. The `args.command` string is passed directly to the shell. An attacker or buggy agent that crafts a command string containing shell metacharacters (`;`, `&&`, `|`, `$()`, backticks) can execute arbitrary commands.
**Impact:** Remote code execution via shell injection. An attacker who controls the chat input or a compromised model response could execute arbitrary shell commands on the host machine.
**Fix:** Switch to `execFile()` with argument arrays, or use `spawn()` directly. If shell features are required, sanitize input or restrict to a whitelist of commands.

### Bug #5 — SQL injection via dynamic column key interpolation
**File:** `src/core/db/chat_thread.ts:105-108` (+ 10+ other db files)
**Root cause:** `Object.keys(thread)` is used to build dynamic SET clauses:
```ts
const fields = Object.keys(thread)
  .filter(key => key !== 'id' && key !== 'created_at' && key !== 'updated_at')
  .map(key => `${key} = @${key}`)
  .join(', ');
```
The column names come from `Object.keys()` of the input object, not from a trusted source. If a caller passes an object with an unexpected or malicious key, it gets interpolated directly into the SQL string. While better-sqlite3 uses parameterized values for `@key`, the column name itself is string-interpolated.
**Impact:** SQL injection via column name manipulation. An attacker who controls the field names in a thread update payload could inject arbitrary SQL into the SET clause.
**Fix:** Validate keys against a whitelist of known column names before interpolation. Reject unknown keys.

### Bug #6 — `pendingApprovalSessions` Map leak on error/disconnect
**File:** `src/main/services/chat/chat_approval.ts:78,475-477`
**Root cause:** `pendingApprovalSessions` Map entries are only cleaned up when all pending approvals for a session are resolved (lines 475-477 in `approveTool`). If the stream errors out, the WebContents disconnects, or the user navigates away mid-approval, those entries are never removed. The `finally` block at line 647-651 only cleans up `activeStreams`, not `pendingApprovalSessions`.
**Impact:** Memory leak. Over long-running sessions with many approval requests, stale entries accumulate indefinitely.
**Fix:** Add cleanup of `pendingApprovalSessions` in error paths, disconnect handlers, and the stream's finally block.

### Bug #7 — Race condition on shared `activeStreams` Map
**File:** `src/main/services/chat/chat_streaming.ts:81` + `chat_approval.ts:482`
**Root cause:** Both `chat_streaming.ts` and `chat_approval.ts` read-modify-write `activeStreams` without synchronization. In `chat_streaming.ts:257-270`, an existing stream is checked, cancelled, and replaced. In `chat_approval.ts:482-543`, the same map is checked and modified. If a new stream starts during an approval resume, they race on the same `senderId` key.
**Impact:** Lost stream state, double-abort, or orphaned AbortControllers. Hard to reproduce but can cause hangs where a stream appears active but never produces output.
**Fix:** Use a per-senderId lock or ensure state transitions are atomic. Consider using a single owner for the Map with explicit handoff.

### Bug #8 — No rate limiting on daemon endpoints
**File:** `src/daemon/server_http.ts`, `src/daemon/server_ws.ts`
**Root cause:** None of the daemon's HTTP or WebSocket endpoints implement rate limiting. An authenticated client (including NapCat bridge) can send unlimited requests, exhausting server resources.
**Impact:** Denial of service. A misconfigured or malicious client can flood the daemon with chat requests, WebSocket connections, or tool executions.
**Fix:** Add per-client rate limiting middleware. Track request counts per `X-Iki-Client` header with a sliding window.

---

## Medium Severity (8)

### Bug #9 — No iteration limit backup guard
**File:** `src/main/services/chat/chat_tool_loop.ts:75`
**Root cause:** The tool loop runs `while (!next.done)` without a local iteration counter. It relies entirely on the harness/runners to enforce `maxIterations`. If the harness is configured without a limit (e.g., due to a config bug), the loop will run unbounded.
**Impact:** Infinite loop consuming CPU and LLM API credits until the process is killed.
**Fix:** Add a hard iteration cap (`MAX_SAFE_ITERATIONS`) as a backup guard within the loop itself.

### Bug #10 — Inverted conditional in `getAgentConfigBase`
**File:** `src/core/agent/ai_sdk_runtime.ts:45-62`
**Root cause:** The conditional at line 46 reads:
```ts
if (overrideConfig) {
  return getDefaultAgentConfig();
}
```
When an `overrideConfig` IS provided, it returns the hardcoded defaults — discarding the override entirely. When no override is provided, it reads from the app config. The logic is inverted: if `overrideConfig` is provided, it should use it as a base; if not, fall back to app config.
**Impact:** Any code path that passes an `overrideConfig` (e.g., daemon chat requests with custom settings) silently gets hardcoded defaults instead. The LLM may use wrong model parameters.
**Fix:** Swap the conditional: return defaults only when NO override is provided AND app config is unavailable.

### Bug #11 — Shutdown doesn't await active connections
**File:** `src/daemon/server.ts:132,147`
**Root cause:** `server.close()` and `wss.close()` are called without awaiting in-flight requests or active WebSocket connections. The server stops accepting new connections but doesn't wait for existing ones to finish.
**Impact:** In-flight chat streams are abruptly terminated on shutdown. Database writes for in-progress messages may be lost.
**Fix:** Track active connections/requests with a counter. During shutdown, stop accepting new connections and wait (with timeout) for the counter to reach zero.

### Bug #12 — `ws.send()` without `readyState` check
**File:** `src/daemon/server_ws.ts:109`
**Root cause:** `sendDaemonPayload` calls `ws.send()` without checking `ws.readyState`. If the WebSocket has closed or is closing, `send()` throws, which propagates as an unhandled error.
**Impact:** Unhandled promise rejection or crash when sending to a disconnected WebSocket.
**Fix:** Check `ws.readyState === 1` (OPEN) before sending. This is already done in the `webContents.send` wrapper at line 86 but not in the `sendDaemonPayload` helper itself, which is also called from other paths.

### Bug #13 — Full body loaded before size check
**File:** `src/daemon/server_shared.ts:67-79`
**Root cause:** The body size check (`bytes > MAX_BODY_BYTES`) runs per-chunk, but `body += chunk.toString('utf8')` accumulates the full body before parsing. While the size IS checked per chunk, a slow-loris-style attack could keep the connection open by sending data just under the chunk size limit.
**Impact:** Memory exhaustion from slow body accumulation. An attacker can send data at a rate just below the per-chunk check.
**Fix:** This is partially mitigated already by checking `bytes > MAX_BODY_BYTES` per chunk. Lower the severity to medium since the protection exists, but improve it by checking total accumulated, not just incremental.

### Bug #14 — Migration 027 missing `down()` method
**File:** `src/core/db/migration/` (migration 027)
**Root cause:** Migration 027 (`restore_legacy_desktop_thread_ownership`) does not have a `down()` method. Downgrades or rollbacks past this migration will fail or leave inconsistent state.
**Impact:** Cannot roll back past migration 027. If a future migration depends on being able to revert, this blocks the downgrade path.
**Fix:** Add a `down()` method that reverses the migration's effects, or explicitly document that this migration is irreversible and handle it gracefully in the migration runner.

### Bug #15 — `config:updated` broadcast before async side-effects complete
**File:** `src/main/ipc/config.ts:489-512`
**Root cause:** The `config:updated` event is broadcast to all renderer windows (line 496) BEFORE the MCP config update and daemon config update (lines 500-505, which are async `.catch()` calls). The renderer reloads its config state before the backend side-effects finish, potentially causing a brief inconsistency window. Additionally, if `shouldAwaitMcp` is false, the async side-effects are fire-and-forget with no error visibility.
**Impact:** Renderer may briefly show stale or inconsistent state after a config save. MCP/daemon config application errors are swallowed (only logged as warn).
**Fix:** Move the broadcast to after the async side-effects settle, or at minimum after they're kicked off with proper error visibility.

### Bug #16 — `thinkingKeys` Set permanently stuck on disconnect
**File:** `src/main/services/companion/companion_service.ts:413`
**Root cause:** `beginThinking(key)` adds a key to the `thinkingKeys` Set, and `endThinking(key)` removes it. If a stream errors out or the sender disconnects without calling `endThinking`, the key is never removed. The companion overlay may remain in "thinking" state permanently.
**Impact:** Companion overlay stuck in thinking animation. The `endThinking` call is in a `finally` block in `chat_streaming.ts:484`, which is good for the normal path, but if the companion service itself fails, or if a different code path calls `beginThinking` without a matching finally, the key leaks.
**Fix:** Add a TTL-based cleanup for stale thinking keys. Periodically evict keys older than a maximum thinking duration.

---

## Low Severity (4)

### Bug #17 — Error masking in `tasks:delete` handler
**File:** `src/main/ipc/tasks.ts:48-58`
**Root cause:** The `tasks:delete` handler wraps the entire operation in try/catch and reports `getErrorMessage(error)`. However, the only explicit throw in the try block is `new Error('Task not found')` when `result.deleted` is false. While other errors (DB failures) would propagate with their actual message, the name "Task not found" is misleading if the task exists but deletion fails for another reason.
**Impact:** Low. Most errors propagate correctly. The masking is limited to the case where `deleted` is false but for reasons other than "not found" — which currently cannot happen since `resolveProactiveTask` returning null is the only way `deleted` is false.
**Fix:** Either remove the try/catch and let errors propagate (since `ipcMain.handle` already catches them), or use distinct error messages for different failure modes.

### Bug #18 — No `close()` API for SQLite connection
**File:** `src/core/db/database.ts:52`
**Root cause:** The `database.ts` module provides `initializeDatabase()` and `getDb()` but never exposes a `close()` method. The SQLite connection handle (`db`) is a module-level variable with no way to gracefully close it.
**Impact:** The daemon shutdown cannot cleanly close the database. better-sqlite3 warns about unclosed connections. On Windows, the WAL files may not be cleaned up.
**Fix:** Add a `closeDatabase()` function that calls `db.close()` and resets the module state.

### Bug #19 — `resetConfig` unhandled promise rejection
**File:** `src/renderer/store/config.ts:118` (already fixed in frontend phase)
**Root cause:** The original code used `void configService.get()...` without `.catch()`. The promise from `configService.get()` could reject, and since it was fire-and-forget with `void`, the rejection was unhandled.
**Status:** FIXED in frontend phase. Added `.catch()` handler.

### Bug #20 — Malformed JSON silently swallowed in NapCat adapter
**File:** `src/daemon/napcat_adapter.ts:1176-1181`
**Root cause:** The WebSocket message handler parses JSON from incoming messages. If parsing fails, the catch block at line 1180-1181 does `return` — silently discarding the message with no logging. This makes debugging protocol mismatches or corrupt messages impossible.
**Impact:** Silent message loss. If NapCat sends malformed JSON, the message is dropped with no visibility. Operators have no way to detect or diagnose the issue.
**Fix:** Log a warning when JSON parsing fails, including the raw data length and connection info.

---

## Root Cause Patterns

1. **Async without await/return (Bugs #1, #11):** `ipcMain.handle` handlers and shutdown logic call async functions without `return` or `await`, silently dropping promises.

2. **Missing error handlers (Bugs #2, #3):** `ipcMain.on` and `ws.on('error')` lack error handling, letting exceptions crash the process.

3. **String interpolation into structured languages (Bugs #4, #5):** User input interpolated into shell commands and SQL column names without sanitization or whitelisting.

4. **Map/Set lifecycle management (Bugs #6, #7, #16):** Shared mutable state (`pendingApprovalSessions`, `activeStreams`, `thinkingKeys`) lacks cleanup in error/disconnect paths.

5. **Missing defensive layers (Bugs #8, #9):** No rate limiting, no backup iteration guard — relying solely on outer-layer enforcement.

6. **Inverted or wrong conditionals (Bug #10):** Simple logic error causes correct-looking code to do the opposite of what's intended.

7. **Silent failures (Bugs #15, #20):** Errors caught and logged at debug/warn level only, or silently discarded, hiding issues from operators.

## Lessons Learned

1. **Prefer `ipcMain.handle` over `ipcMain.on`:** `handle` automatically catches exceptions and returns errors to the renderer. Use `on` only for fire-and-forget events, and wrap in try/catch.

2. **Always add error handlers:** Every WebSocket needs `on('error')`. Every stream needs cleanup in `finally`. Every Map/Set mutation needs a corresponding delete.

3. **Never interpolate user input into SQL or shell:** Use parameterized queries (`@param`) for VALUES, and whitelists for identifiers. Use `execFile`/`spawn` instead of `exec`.

4. **Add backup guards:** Even when the architecture enforces limits (e.g., maxIterations in the runner), add a hard cap at the loop level. Defense in depth.

5. **Log all parse failures:** Silently dropping malformed input makes debugging impossible. At minimum, log a warning with context.
