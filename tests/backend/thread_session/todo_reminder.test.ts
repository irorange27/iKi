import { describe, expect, it } from 'vitest';
import { TODO_PLANNING_TOOL_NAME } from '@iki/backend/tools/task_plan_tools';
import { todoReminderFor, TODO_REMINDER_MESSAGE } from '@iki/backend/thread_session/todo_reminder';

const step = (...names: string[]) => ({ toolCalls: names.map(name => ({ name })) });

describe('todo reminder', () => {
  it('stays silent when the plan tool is not enabled', () => {
    const steps = [step('web_search'), step('read_file'), step('shell')];
    expect(todoReminderFor(steps, ['web_search', 'read_file', 'shell'])).toBeUndefined();
  });

  it('stays silent inside the first steps even with several tools', () => {
    const steps = [step('web_search'), step('read_file')];
    expect(todoReminderFor(steps, [TODO_PLANNING_TOOL_NAME, 'web_search', 'read_file'])).toBeUndefined();
  });

  it('nudges once the model has used two distinct tools for three rounds', () => {
    const steps = [step('web_search'), step('read_file'), step('web_search')];
    expect(todoReminderFor(steps, [TODO_PLANNING_TOOL_NAME, 'web_search', 'read_file'])).toBe(
      TODO_REMINDER_MESSAGE
    );
  });

  it('treats one repeated tool as refinement, not as plannable work', () => {
    const steps = [step('web_search'), step('web_search'), step('web_search')];
    expect(todoReminderFor(steps, [TODO_PLANNING_TOOL_NAME, 'web_search'])).toBeUndefined();
  });

  it('nudges a single tool once it has clearly been iterated', () => {
    const steps = [step('web_search'), step('web_search'), step('web_search', 'web_search')];
    expect(todoReminderFor(steps, [TODO_PLANNING_TOOL_NAME, 'web_search'])).toBe(
      TODO_REMINDER_MESSAGE
    );
  });

  it('restarts the count after the model updates the plan', () => {
    const steps = [
      step('web_search'),
      step('read_file'),
      step('web_search'),
      step(TODO_PLANNING_TOOL_NAME),
      step('web_search'),
    ];
    expect(todoReminderFor(steps, [TODO_PLANNING_TOOL_NAME, 'web_search', 'read_file'])).toBeUndefined();
  });

  it('ignores thinking-only steps when deciding complexity', () => {
    const steps = [step(), step(), step(), step('web_search'), step('read_file'), step('shell')];
    expect(todoReminderFor(steps, [TODO_PLANNING_TOOL_NAME, 'web_search', 'read_file'])).toBe(
      TODO_REMINDER_MESSAGE
    );
  });
});
