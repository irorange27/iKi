# Shared Types and Utilities

## Purpose
Provide shared configuration schemas, types, and utilities used by both main and renderer.

## Responsibilities
- Define AppConfig shape and defaults.
- Normalize config via Zod schema.
- Define shared types for chat, skills, providers, tasks, and workflow.
- Provide small shared utilities (model list parsing, guards, chat codecs).

## Key Files
- `src/shared/types/config.ts`: AppConfig interface.
- `src/shared/config/defaults.ts`: default configuration values.
- `src/shared/config/schema.ts`: Zod validation schema.
- `src/shared/config/normalize.ts`: normalization helper.
- `src/shared/types/chat.ts`: chat thread/message types.
- `src/shared/types/provider.ts`: provider types.
- `src/shared/types/skill.ts`: skill types.
- `src/shared/types/tasks.ts`: proactive task types.
- `src/shared/types/workflow.ts`: workflow optimization types.
- `src/shared/utils/provider_models.ts`: model list parsing.

## Invariants
- All config reads/writes should pass through normalization.
- Shared types are the single source of truth for serialization.

## Extension Points
- Add new config sections with matching defaults and schema.
- Add shared helper utilities under `src/shared/utils`.

## Failure Modes
- Invalid raw config values are coerced to defaults by schema.
