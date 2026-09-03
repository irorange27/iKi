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
