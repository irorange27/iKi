# @iki/desktop

Electron shell. Three layers:

- **`src/main/`** — Electron main process. IPC handlers (`ipc/`), window management (`windows/`), platform services (`services/`). Should be thin: register handlers, delegate to `@iki/backend`.
- **`src/preload/`** — `contextBridge` exposing the typed `electronAPI` to renderer. The contract is `packages/backend/src/types/electron_api.ts` (imported as `@iki/backend/types/electron_api`); the renderer-side accessor copy is `src/renderer/services/electron_api.ts`.
- **`src/renderer/`** — Vue 3 + Tailwind SPA. All DOM interaction goes through composables (`composables/`), views (`views/`). Chat state lives in an `@ai-sdk/vue` `Chat` store (`modules/chat/`); Pinia (`store/`) holds config only.

**`src/main.ts`** is the single entry. With `--daemon` it bootstraps `@iki/daemon` headlessly instead of opening windows.

## Don't

- Don't put business logic in `main/`. Anything more than "translate IPC arg → backend call → return result" belongs in `@iki/backend`.
- Don't use `ipcMain.on` for anything that can throw — it doesn't catch exceptions. Use `ipcMain.handle`. See repo `postmortem/backend-bugs-2026-04.md` Bug #2.
- Don't bundle native or OTel deps into the Vite main chunk. Add them to `VITE_EXTERNAL_RUNTIME_DEPS` in `src/build/runtime_packaging.ts`.

See repo root [AGENTS.md](../../AGENTS.md).

## Trajectory presentation

`views/TrajectoryView.vue` composes `components/run/TrajectoryTiming.vue`, `TrajectoryLedger.vue`, and `TrajectoryDetail.vue`. `composables/useTrajectory.ts` owns the mounted view's serialized refresh, terminal-status subscription, polling and completed-trace cache; generation checks prevent a previous thread's late response from replacing the current one. `modules/run/trajectory_ledger.ts` is a pure presentation projection of backend run traces, not a second recorder or history builder.

- Chat and trajectory share one mounted composer. Switching views preserves the draft and send/stop controls.
- Groups are **runs**, including approval resumes and delegated runs. Run inspection and actions work even before a run has any steps. Step and prepared-context records remain distinct; Raw exposes their source.
- Default timeline geometry represents record order. The Time option uses recorded timestamps. Append-time audit records do not establish model/tool execution durations; missing spans must not become invented latency.
- Approval review returns to chat and the existing approval owner. Retry uses `retryAndExecute`; a queued retry alone does not execute work.
- Preserve failed-send feedback after restoring the draft (`useChatComposerSend`), and derive tool success/failure wording from the shared tool state (`ui_message_tool_groups`, `ToolCallGroup`, `ToolCallPart`).

Regression owners: `tests/renderer/components/TrajectoryView.test.ts`, `tests/renderer/composables/useTrajectory.test.ts`, `tests/renderer/modules/run/trajectory_ledger.test.ts`, `tests/renderer/views/ChatView.test.ts`, and the existing composer/tool-group suites. Run `ci:quality` and the real Electron `test:e2e` gate for cross-layer changes.

The E2E gate uses its own profile and process groups. Occupied ports fail without killing unrelated apps. When another dev instance is open, run from a separate checkout/build directory and choose free `CDP_PORT`, `IKI_VITE_PORT`, `IKI_E2E_DAEMON_PORT`, and `IKI_E2E_FAUX_PORT` values. Keep dependency installations isolated too; a writable `node_modules` symlink shares package-manager side effects.
