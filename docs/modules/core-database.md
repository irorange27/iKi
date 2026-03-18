# Core Database

## Purpose
Provide local persistence using SQLite for configuration, providers, chat data,
memory, tasks, workflow profiles, and daemon clients.

## Responsibilities
- Initialize and migrate the SQLite database.
- Store and retrieve config and application state.
- Provide CRUD helpers for all tables used by the app and daemon.

## Key Files
- `src/core/db/database.ts`: database initialization and config storage.
- `src/core/db/migration/*`: schema migrations.
- `src/core/db/providers.ts`: provider CRUD.
- `src/core/db/chat_thread.ts`: chat thread CRUD.
- `src/core/db/chat_message.ts`: chat message CRUD.
- `src/core/db/memory.ts`: memory tables and retrieval helpers.
- `src/core/db/emotion.ts`: emotion events storage.
- `src/core/db/tasks.ts`: proactive task storage.
- `src/core/db/workflow_profile.ts`: workflow profile storage.
- `src/core/db/app_clients.ts`: daemon client tokens and scopes.
- `src/core/db/workspaces.ts`: workspace CRUD.

## Data Flow
1. `initializeDatabase()` opens the SQLite file and runs migrations.
2. CRUD helpers execute parameterized queries with predictable schemas.
3. Higher-level services use these helpers; no raw SQL outside the module.

## Invariants
- Config values are JSON-encoded in the `config` table.
- Boolean columns are normalized to JS booleans on read.
- Chat messages are stored as serialized UI message JSON.

## Extension Points
- Add new migrations under `src/core/db/migration`.
- Add new table-specific helpers in `src/core/db/`.

## Failure Modes
- Invalid JSON in config or message payloads is handled with safe fallbacks.
- Missing rows return null instead of throwing.

## Testing
- `tests/core/db/tasks.test.ts`
- `tests/core/memory/memory_db_crud.test.ts`
