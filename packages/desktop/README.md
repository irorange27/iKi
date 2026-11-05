# @iki/desktop

> **中文导读**（下方为英文契约正文）
>
> Electron 薄壳，三层：`src/main/`（IPC 注册、窗口、平台服务，只做转发）、`src/preload/`（contextBridge 暴露 `electronAPI`）、`src/renderer/`（Vue 3 + Tailwind SPA）。唯一入口是 [src/main.ts](src/main.ts)。
>
> - **禁令**：[Don't](#dont) —— main 层不写业务逻辑；用 `ipcMain.handle`；native / OTel 依赖列入 `VITE_EXTERNAL_RUNTIME_DEPS`；teleported portal 由全局样式接管。
> - **打包**：[Packaging](#packaging-what-the-asar-actually-contains) —— asar 才是真正的消费边界，打 tag 前本地 package 并从终端启动看 stderr。
> - **轨迹与失效契约**：[Trajectory presentation](#trajectory-presentation)、[Renderer invalidation contracts](#renderer-invalidation-contracts)。
> - 依赖单向：`@iki/desktop` → `@iki/backend` / `@iki/theme`；IPC 契约类型在 `@iki/backend/types/electron_api`。
> - 常用命令：`pnpm run app:dev`、`pnpm run app:debug` + `pnpm run cdp`、`pnpm run ci:quality`。
>
> ⚠️ 正文含 2026-10 快照，个别命令、模块与供应层描述可能已退役；以代码为准。改前读 [AGENTS.md](../../AGENTS.md)。

Electron shell. Three layers:

- **`src/main/`** — Electron main process. IPC handlers (`ipc/`), window management (`windows/`), platform services (`services/`). Should be thin: register handlers, delegate to `@iki/backend`.
- **`src/preload/`** — `contextBridge` exposing the typed `electronAPI` to renderer. The contract is `packages/backend/src/types/electron_api.ts` (imported as `@iki/backend/types/electron_api`); the renderer-side accessor copy is `src/renderer/services/electron_api.ts`.
- **`src/renderer/`** — Vue 3 + Tailwind SPA. All DOM interaction goes through composables (`composables/`), views (`views/`). Chat state is the AI SDK's vanilla `AbstractChat` (`ai` package), wired in `modules/chat/`; Pinia (`store/`) holds config and the selected-thread store (`thread_session`).

**`src/main.ts`** is the single entry. With `--iki-daemon` it bootstraps `@iki/daemon` headlessly instead of opening windows.

## Don't

- Don't put business logic in `main/`. Anything more than "translate IPC arg → backend call → return result" belongs in `@iki/backend`.
- Don't use `ipcMain.on` for anything that can throw — it doesn't catch exceptions. Use `ipcMain.handle`. See repo `postmortem/backend-bugs-2026-04.md` Bug #2.
- Don't ship a preload channel without a main handler (or the reverse), or a push nobody subscribes to. `tests/main/ipc/channel_registry.test.ts` cross-checks every channel in both directions; the mirror-style per-module tests were deleted in favor of it.
- Don't bundle native or OTel deps into the Vite main chunk. Add them to `VITE_EXTERNAL_RUNTIME_DEPS` in `src/build/runtime_packaging.ts`.
- Don't poll or persist the system clipboard for automatic agent context. Explicit paste into the composer remains user supplied message content.
- Don't style teleported reka-ui popover/panel roots with scoped CSS — the portal mounts on `<body>` outside the component subtree, so the parent's scope attributes never reach it. Global styles own those surfaces (`assets/styles/globals.css`: `selector-panel`, `permission-panel`, `sidebar-project-panel`, …).

See repo root [AGENTS.md](../../AGENTS.md).

## Packaging (what the asar actually contains)

The Vite main bundle keeps a small set of runtime externals (`VITE_EXTERNAL_RUNTIME_DEPS` in `src/build/runtime_packaging.ts`): otel/langfuse (see the Don't above), whisper-node, ffmpeg-static. Those packages' installed real paths live outside this project dir (monorepo root `node_modules`), so the packager's own file walk can never include them — `forge.config.ts` stages the resolved closure with an `afterCopy` hook and runs with `prune: false`.

- Adding a runtime external: add it to `VITE_EXTERNAL_RUNTIME_DEPS`. A name with a single installed version hoists to the app's `node_modules` root; a second version of the same name nests under the consumer that pulls it (hoisting/LCA/placement-cap rules live in `runtime_packaging.ts`).
- Binary-drop packages (whisper-node, ffmpeg-static) stage only their include list from `getRuntimePackageRules` and must declare `unpack` entries — executables cannot load from inside the asar.
- The staged closure stays ~100 MB. A far-larger asar means the closure leaked (the `electron` npm package alone is 800 MB — at runtime it resolves to the builtin module and is excluded by the resolver).
- Regression owner: `tests/build/runtime_packaging.test.ts` — hoisting, per-consumer nesting for conflicting versions, LCA sharing on diamond graphs, and the packaging ignore rules.

The packaged app is the real consumer boundary for packaging changes: `pnpm exec electron-forge package` inside `packages/desktop`, then launch the bundle's executable from a terminal — `out/iki-darwin-<arch>/iki.app/Contents/MacOS/iki` (arm64 machines: `out/iki-darwin-arm64`) — and watch stderr. Release steps: `docs/design/packaging-release.md` (local).

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

Boundary regressions: `useChatUsage.test.ts` exercises real SDK state replacements and store history replacement; `ui_reference_caches.test.ts` covers source freshness and per-key subscriptions; `useTurnRail.test.ts` covers frame coalescing and disposal. Sidebar, trajectory and ChatView suites cover subscription and view lifetime behavior.
