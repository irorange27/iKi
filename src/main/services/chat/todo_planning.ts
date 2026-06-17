import { generateText } from 'ai';

const TODO_TOOL_NAME = 'todo';
const TODO_REMINDER_AFTER_STEPS = 3;
const TODO_REMINDER_TEXT = '<reminder>Update your todos.</reminder>';

type StepWithToolCalls = {
  toolCalls?: ReadonlyArray<{ toolName?: string }>;
};

type TodoPrepareStep = NonNullable<Parameters<typeof generateText>[0]['prepareStep']>;
type PrepareStepOptions = Parameters<TodoPrepareStep>[0];
type PrepareStepResult = ReturnType<TodoPrepareStep>;

const stepUsedTodo = (step: StepWithToolCalls): boolean =>
  Array.isArray(step.toolCalls)
    ? step.toolCalls.some(
        toolCall =>
          typeof toolCall?.toolName === 'string' &&
          toolCall.toolName.trim().toLowerCase() === TODO_TOOL_NAME
      )
    : false;

const getNonTodoToolCalls = (step: StepWithToolCalls): string[] =>
  Array.isArray(step.toolCalls)
    ? step.toolCalls
        .map(toolCall =>
          typeof toolCall?.toolName === 'string' ? toolCall.toolName.trim().toLowerCase() : ''
        )
        .filter(toolName => toolName.length > 0 && toolName !== TODO_TOOL_NAME)
    : [];

const countRoundsSinceTodo = (steps: ReadonlyArray<StepWithToolCalls>): number => {
  let roundsSinceTodo = 0;

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (stepUsedTodo(steps[index])) {
      return roundsSinceTodo;
    }
    roundsSinceTodo += 1;
  }

  return roundsSinceTodo;
};

const hasMeaningfullyComplexTodoCandidate = (steps: ReadonlyArray<StepWithToolCalls>): boolean => {
  let nonTodoRounds = 0;
  let nonTodoToolCallCount = 0;
  const distinctNonTodoTools = new Set<string>();

  for (const step of steps) {
    if (stepUsedTodo(step)) continue;
    const nonTodoTools = getNonTodoToolCalls(step);
    if (nonTodoTools.length === 0) continue;

    nonTodoRounds += 1;
    nonTodoToolCallCount += nonTodoTools.length;
    for (const toolName of nonTodoTools) {
      distinctNonTodoTools.add(toolName);
    }
  }

  if (nonTodoRounds < TODO_REMINDER_AFTER_STEPS) return false;
  if (distinctNonTodoTools.size >= 2) return true;
  return nonTodoToolCallCount >= TODO_REMINDER_AFTER_STEPS + 1;
};

export const createTodoPrepareStep = (
  enabledTools: string[]
): TodoPrepareStep | undefined => {
  if (!enabledTools.some(toolName => toolName.trim().toLowerCase() === TODO_TOOL_NAME)) {
    return undefined;
  }

  return ({ steps, messages }: PrepareStepOptions): PrepareStepResult => {
    if (countRoundsSinceTodo(steps) < TODO_REMINDER_AFTER_STEPS) {
      return undefined;
    }
    if (!hasMeaningfullyComplexTodoCandidate(steps)) {
      return undefined;
    }

    return {
      messages: [
        ...messages,
        {
          role: 'user',
          content: TODO_REMINDER_TEXT,
        },
      ],
    };
  };
};

export const TODO_PLANNING_TOOL_NAME = TODO_TOOL_NAME;
export const TODO_REMINDER_THRESHOLD_STEPS = TODO_REMINDER_AFTER_STEPS;
export const TODO_REMINDER_MESSAGE = TODO_REMINDER_TEXT;
