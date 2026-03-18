# Main IPC

## Purpose
Expose main-process services to the renderer through Electron IPC, keeping the
renderer stateless and platform-safe.

## Responsibilities
- Register IPC handlers for chat, config, providers, tools, skills, tasks, and workflow.
- Bridge IPC calls to service and database layers.
- Broadcast config updates to renderer windows.

## Key Files
- `src/main/ipc/index.ts`: registration entry point.
- `src/main/ipc/chat.ts`: chat IPC handlers.
- `src/main/ipc/config.ts`: config load/save and migration.
- `src/main/ipc/providers.ts`: provider CRUD.
- `src/main/ipc/tools.ts`: tool metadata list.
- `src/main/ipc/skills.ts`: skill discovery and open operations.
- `src/main/ipc/tasks.ts`: proactive task CRUD and run-now.
- `src/main/ipc/tool_model.ts`: tool model and title generation.
- `src/main/ipc/workspaces.ts`: workspace CRUD.

## Data Flow
1. Renderer calls `window.electronAPI.*`.
2. IPC handler invokes main service or DB helper.
3. Results are returned to the renderer.

## Invariants
- Each IPC module is registered once.
- Config writes are normalized before persistence.

## Extension Points
- Add new IPC modules for new subsystems.
- Add new handlers in existing modules with stable channel names.

## Failure Modes
- Exceptions inside handlers are logged and returned as errors to UI.
