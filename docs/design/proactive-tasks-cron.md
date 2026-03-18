# Proactive Task Cron Scheduling

## Context
Proactive tasks currently run on simple minute intervals. Users need cron-style
schedules to align tasks with fixed times and weekdays.

## Goals
- Support cron expressions in the UI and IPC.
- Compute `next_run_at` deterministically with explicit timezone handling.
- Preserve existing interval schedule behavior.

## Non-goals
- No visual cron builder or preview timeline.
- No multiple schedules per task or exception calendars.

## Design
### Data model
Add columns to `proactive_tasks`:
- `cron_expression` (TEXT, nullable)
- `schedule_timezone` (TEXT, nullable)

`schedule_type` now supports `interval` and `cron`. For cron tasks,
`interval_minutes` remains stored for compatibility but is not used for scheduling.

### Scheduling logic
- A shared schedule utility computes `next_run_at`.
- Cron expressions are parsed via `cron-parser` (5-field expressions supported).
- `schedule_timezone` is optional; if empty, the system timezone is used.
- `next_run_at` is recalculated on create, schedule updates, enable toggles,
  and after each run.

### UI
- Add a schedule type selector (interval vs cron).
- Show cron expression + optional timezone inputs when cron is selected.
- Existing tasks display a schedule summary and expose either interval or cron
  fields for editing.

### Validation and errors
- Cron expression is required for cron schedules.
- Invalid cron expressions are rejected in IPC with a descriptive error.
- If an invalid cron expression slips into storage, runtime scheduling falls
  back to interval defaults and logs a warning.
