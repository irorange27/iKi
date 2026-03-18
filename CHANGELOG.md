# Changelog

## v0.0.1
- Refactored ChatInput speech handling into a composable and extracted UI message conversion helpers.
- Added a design note and postmortem for the chat input refactor.
- Added workflow self-optimization with auto tool routing and auto-pinned skills per thread.
- Added workflow profiles storage, settings toggle/reset, and a design note for the optimization loop.
- Integrated emotion context into the agent decision loop with configurable affect aggregation.
- Added emotion event storage, tests, and documentation for the new emotion pipeline.
- Added optional real-time emotion analysis for current responses (configurable).
- Persisted per-thread affect state and surfaced it in the Memory viewer.
- Added affect-based tool guardrails with configurable thresholds.
- Added UI CRUD for long-term memory entries with IPC update/delete hooks and manual creation.
- Added unit tests covering proactive task IPC, scheduling runs, and database updates.
- Added cron-based scheduling for proactive tasks with UI support and persistence.
- Added an MCP support design plan covering architecture, data model, UI, and security.
- Added per-module documentation under docs/modules.
