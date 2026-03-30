import { describe, expect, it } from 'vitest';

import {
  createTodoPrepareStep,
  TODO_PLANNING_TOOL_NAME,
  TODO_REMINDER_MESSAGE,
  TODO_REMINDER_THRESHOLD_STEPS,
} from '../../../../src/main/services/chat/chat_todo_planning';

describe('chat_todo_planning', () => {
  it('stays disabled when todo is not in the enabled tool set', () => {
    expect(createTodoPrepareStep(['web', 'shell'])).toBeUndefined();
  });

  it('injects a reminder after enough non-todo steps', () => {
    const prepareStep = createTodoPrepareStep([TODO_PLANNING_TOOL_NAME]);
    if (!prepareStep) throw new Error('Expected todo prepareStep');

    const result = prepareStep({
      stepNumber: TODO_REMINDER_THRESHOLD_STEPS + 1,
      steps: [
        { toolCalls: [{ toolName: 'web' }] },
        { toolCalls: [{ toolName: 'read_file' }] },
        { toolCalls: [{ toolName: 'shell' }] },
      ],
      model: {} as never,
      messages: [{ role: 'user', content: 'Implement the fix.' }],
      experimental_context: undefined,
    });

    expect(result).toEqual({
      messages: [
        { role: 'user', content: 'Implement the fix.' },
        { role: 'user', content: TODO_REMINDER_MESSAGE },
      ],
    });
  });

  it('does not inject a reminder when todo was used recently', () => {
    const prepareStep = createTodoPrepareStep([TODO_PLANNING_TOOL_NAME]);
    if (!prepareStep) throw new Error('Expected todo prepareStep');

    const result = prepareStep({
      stepNumber: 3,
      steps: [
        { toolCalls: [{ toolName: 'web' }] },
        { toolCalls: [{ toolName: TODO_PLANNING_TOOL_NAME }] },
        { toolCalls: [{ toolName: 'read_file' }] },
      ],
      model: {} as never,
      messages: [{ role: 'user', content: 'Implement the fix.' }],
      experimental_context: undefined,
    });

    expect(result).toBeUndefined();
  });
});
