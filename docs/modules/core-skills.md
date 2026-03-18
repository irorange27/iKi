# Core Skills

## Purpose
Discover and load reusable instruction packs from local `SKILL.md` files, and
expose them for manual or auto skill selection.

## Responsibilities
- Scan skill roots and cache skill metadata.
- Normalize skill ids and provide content reading.
- Serve skill roots and skill content to the UI.

## Key Files
- `src/core/skills/index.ts`: scanning, caching, and skill content access.
- `src/main/ipc/skills.ts`: IPC for listing and opening skills.

## Data Flow
1. Skill roots are resolved from user data and CODEX_HOME.
2. Directory trees are scanned for `SKILL.md`.
3. Metadata is cached for fast list operations.
4. Full skill content is read on demand.

## Invariants
- Skill ids are stable and source-qualified (user/codex).
- Scan depth and skip directories prevent expensive filesystem walks.
- Content is truncated for UI reads to avoid large payloads.

## Extension Points
- Add new skill roots or sources.
- Modify scan depth or skip list for performance.

## Failure Modes
- Missing skill roots return empty lists.
- Read failures return empty content instead of throwing.
