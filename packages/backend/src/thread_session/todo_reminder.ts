import { TODO_PLANNING_TOOL_NAME } from '@iki/backend/tools/task_plan_tools';

/** After this many consecutive non-todo steps the model is nudged. */
const TODO_REMINDER_AFTER_STEPS = 3;
export const TODO_REMINDER_MESSAGE = '<reminder>Update your todos.</reminder>';

/** The slice of a settled loop step the reminder rule reads. */
export type TodoReminderStep = {
  toolCalls: ReadonlyArray<{ name: string }>;
};

const normalized = (value: string): string => value.trim().toLowerCase();

const stepUsedTodo = (step: TodoReminderStep): boolean =>
  step.toolCalls.some(call => normalized(call.name) === TODO_PLANNING_TOOL_NAME);

/** Consecutive steps since the last todo call; `steps.length` when none. */
const roundsSinceTodo = (steps: ReadonlyArray<TodoReminderStep>): number => {
  let rounds = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (stepUsedTodo(steps[index])) return rounds;
    rounds += 1;
  }
  return rounds;
};

/**
 * Whether the work so far looks complex enough that a plan is worth asking
 * for: several rounds of tool use, or two distinct tools. A single repeated
 * tool is not — that is usually one search being refined, and a reminder
 * there is noise.
 */
const looksLikePlannableWork = (steps: ReadonlyArray<TodoReminderStep>): boolean => {
  const distinct = new Set<string>();
  let rounds = 0;
  let calls = 0;
  for (const step of steps) {
    if (stepUsedTodo(step)) continue;
    const names = step.toolCalls.map(call => normalized(call.name)).filter(Boolean);
    if (names.length === 0) continue;
    rounds += 1;
    calls += names.length;
    for (const name of names) distinct.add(name);
  }
  if (rounds < TODO_REMINDER_AFTER_STEPS) return false;
  return distinct.size >= 2 || calls >= TODO_REMINDER_AFTER_STEPS + 1;
};

/**
 * The reminder text to append before the next model call, or undefined when
 * no nudge is due. Owner: `thread_session` (the plan's lifetime is the
 * turn's); the Pi tool harness calls this once per model request, so a long
 * turn is reminded mid-flight rather than only at the next turn start.
 *
 * The plan itself is cleared per turn by `session_loop`, so a reminder is
 * what keeps `write_todo_list` from being a one-shot at t=0.
 */
export const todoReminderFor = (
  steps: ReadonlyArray<TodoReminderStep>,
  enabledToolNames: ReadonlyArray<string>
): string | undefined => {
  const todoEnabled = enabledToolNames.some(name => normalized(name) === TODO_PLANNING_TOOL_NAME);
  if (!todoEnabled) return undefined;
  if (roundsSinceTodo(steps) < TODO_REMINDER_AFTER_STEPS) return undefined;
  if (!looksLikePlannableWork(steps)) return undefined;
  return TODO_REMINDER_MESSAGE;
};
