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
- Don't style teleported reka-ui popover/panel roots with scoped CSS — the portal mounts on `<body>` outside the component subtree, so the parent's scope attributes never reach it. Global styles own those surfaces (`assets/styles/globals.css`: `selector-panel`, `permission-panel`, `sidebar-project-panel`, …).

See repo root [AGENTS.md](../../AGENTS.md).

## Packaging (what the asar actually contains)

The Vite main bundle keeps a small set of runtime externals (`VITE_EXTERNAL_RUNTIME_DEPS` in `src/build/runtime_packaging.ts`): otel/langfuse (see the Don't above), whisper-node, ffmpeg-static. Those packages' installed real paths live outside this project dir (monorepo root `node_modules`), so the packager's own file walk can never include them — `forge.config.ts` stages the resolved closure with an `afterCopy` hook and runs with `prune: false`.

- Adding a runtime external: add it to `VITE_EXTERNAL_RUNTIME_DEPS`. A name with a single installed version hoists to the app's `node_modules` root; a second version of the same name nests under the consumer that pulls it (hoisting/LCA/placement-cap rules live in `runtime_packaging.ts`).
- Binary-drop packages (whisper-node, ffmpeg-static) stage only their include list from `getRuntimePackageRules` and must declare `unpack` entries — executables cannot load from inside the asar.
- The staged closure stays ~100 MB. A far-larger asar means the closure leaked (the `electron` npm package alone is 800 MB — at runtime it resolves to the builtin module and is excluded by the resolver).
- Regression owner: `tests/build/runtime_packaging.test.ts` — hoisting, per-consumer nesting for conflicting versions, LCA sharing on diamond graphs, and the packaging ignore rules.

The packaged app is the real consumer boundary for packaging changes: `pnpm exec electron-forge package` inside `packages/desktop`, then launch `out/iki-darwin-arm64/iki.app` once and watch stderr. Release steps: `docs/design/packaging-release.md` (local).

## Trajectory presentation

`views/TrajectoryView.vue` composes `components/run/TrajectoryTiming.vue`, `TrajectoryLedger.vue`, and `TrajectoryDetail.vue`. `composables/useTrajectory.ts` owns the mounted view's serialized refresh, terminal-status subscription, polling and completed-trace cache; generation checks prevent a previous thread's late response from replacing the current one. `modules/run/trajectory_ledger.ts` is a pure presentation projection of backend run traces, not a second recorder or history builder.

- Chat and trajectory share one mounted composer. Switching views preserves the draft and send/stop controls.
- Groups are **runs**, including approval resumes and delegated runs. Run inspection and actions work even before a run has any steps. Step and prepared-context records remain distinct; Raw exposes their source.
- Default timeline geometry represents record order. The Time option uses recorded timestamps. Append-time audit records do not establish model/tool execution durations; missing spans must not become invented latency.
- Approval review returns to chat and the existing approval owner. Retry uses `retryAndExecute`; a queued retry alone does not execute work.
- Preserve failed-send feedback after restoring the draft (`useChatComposerSend`), and derive tool success/failure wording from the shared tool state (`ui_message_tool_groups`, `ToolCallGroup`, `ToolCallPart`).

Regression owners: `tests/renderer/components/TrajectoryView.test.ts`, `tests/renderer/composables/useTrajectory.test.ts`, `tests/renderer/modules/run/trajectory_ledger.test.ts`, `tests/renderer/views/ChatView.test.ts`, and the existing composer/tool-group suites. Run `ci:quality` and the real Electron `test:e2e` gate for cross-layer changes.

The E2E gate uses its own profile and process groups. Occupied ports fail without killing unrelated apps. When another dev instance is open, run from a separate checkout/build directory and choose free `CDP_PORT`, `IKI_VITE_PORT`, `IKI_E2E_DAEMON_PORT`, and `IKI_E2E_FAUX_PORT` values. Keep dependency installations isolated too; a writable `node_modules` symlink shares package-manager side effects.

## Renderer invalidation contracts

- `ui_message_references.ts` collects reference sources once per message projection. WeakMap entries are keyed by the parts array and validated against tool names/IDs and input/output/data sources. SDK writes mutate the live parts array off-proxy; neither message identity nor array identity alone proves freshness. Payload data follows the SDK's replacement contract; do not mutate nested payloads behind these caches.
- `useChatUsage` aggregates on applied usage notifications, SDK message-count changes and `chat_message_store.revision`. Store revision covers same-length history replacement, editing and truncation. The aggregation reads raw snapshots deliberately, so text-delta replacements do not subscribe it to every message index. Equal numeric/string results retain their previous references for the composer and stats bar.
- `tool_ui_state` replaces values in a stable shallow-reactive record. Subscribers track individual tool/group keys; resetting deletes keys so existing subscribers also observe the reset.
- `useTurnRail` owns DOM measurement, preview state, observers and timers. Resize notifications coalesce into one animation-frame measurement; hidden chat panels do not measure, and unchanged marker IDs retain their reference.
- `thread_session` owns selected-thread state and a thread-list invalidation revision, never a Sidebar component instance. Sidebar subscribes to both and ignores superseded list responses.
- Trajectory mounts on first use, preserves its UI/cache across tab switches and pauses polling while hidden. Reopening refreshes the run list and reuses unchanged completed traces. Components obtain Electron services from `services/electron_api`; composables accept explicit service dependencies.

Boundary regressions: `useChatUsage.test.ts` exercises real SDK state replacements and store history replacement; `chat_render_cache.test.ts` covers source freshness and per-key subscriptions; `useTurnRail.test.ts` covers frame coalescing and disposal. Sidebar, trajectory and ChatView suites cover subscription and view lifetime behavior.
