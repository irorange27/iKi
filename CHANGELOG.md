# Changelog

## 2026-03-18
- Refactored ChatInput speech handling into a composable and extracted UI message conversion helpers.
- Added a design note and postmortem for the chat input refactor.
- Integrated emotion context into the agent decision loop with configurable affect aggregation.
- Added emotion event storage, tests, and documentation for the new emotion pipeline.
- Added UI CRUD for long-term memory entries with IPC update/delete hooks and manual creation.
