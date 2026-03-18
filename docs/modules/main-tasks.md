# Main Tasks

## Purpose
Provide scheduled and manual execution of proactive tasks that run chat prompts
on a cadence and post results to a dedicated thread.

## Responsibilities
- Store and update task schedule metadata.
- Run tasks on schedule or manual trigger.
- Enforce safe tool allowlist for automated tasks.
- Notify UI and desktop notifications on completion.
- Validate cron expressions and schedule timezone inputs.

## Key Files
- `src/main/services/tasks/proactive_tasks.ts`: scheduler and execution.
- `src/main/services/tasks/task_schedule.ts`: interval + cron scheduling helpers.
- `src/main/ipc/tasks.ts`: IPC for CRUD and run-now.
- `src/core/db/tasks.ts`: task storage.

## Data Flow
1. Scheduler checks due tasks every tick.
2. Task is locked to prevent overlapping runs.
3. A dedicated thread is created (if missing).
4. Chat service executes the task prompt.
5. Result is stored, notified, and next run scheduled.

## Invariants
- Task interval is clamped between 1 minute and 7 days.
- Cron schedules require a valid cron expression and optional timezone.
- Automated tasks only allow safe tools: web, fetch, read_file, list_dir.
- Each task run updates `last_status`, `last_run_at`, and `next_run_at`.

## Extension Points
- Add new schedule types beyond interval/cron.
- Extend safe tool allowlist or policy.

## Failure Modes
- Task execution failures are persisted and reported with notifications.
- Overlapping runs are rejected with "Task already running".

## Testing
- `tests/main/services/tasks/proactive_tasks.test.ts`
- `tests/main/ipc/tasks.test.ts`
