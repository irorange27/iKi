import { TODO_PLANNING_TOOL_NAME } from '@iki/backend/tools/task_plan_tools';

const TODO_REMINDER_AFTER_STEPS = 3;
export const TODO_REMINDER_MESSAGE = '<reminder>Update your todos.</reminder>';

export type TodoReminderStep = {
  toolCalls: ReadonlyArray<{ name: string }>;
};

const normalized = (value: string): string => value.trim().toLowerCase();

const stepUsedTodo = (step: TodoReminderStep): boolean =>
  step.toolCalls.some(call => normalized(call.name) === TODO_PLANNING_TOOL_NAME);

const roundsSinceTodo = (steps: ReadonlyArray<TodoReminderStep>): number => {
  let rounds = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (stepUsedTodo(steps[index])) return rounds;
    rounds += 1;
  }
  return rounds;
};

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
