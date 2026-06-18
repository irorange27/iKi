import { describe, expect, it } from 'vitest';

import {
  MAX_EXECUTION_TASK_PLAN_ITEMS,
  MAX_TASK_PLAN_ITEMS,
  normalizeTaskPlanItems,
  renderTaskPlan,
  summarizeTaskPlan,
} from '@iki/core/db/task_plan';

describe('task_plan helpers', () => {
  it('normalizes ids, statuses, and summary counts', () => {
    const items = normalizeTaskPlanItems([
      { text: 'Inspect current code' },
      { id: 'b', text: 'Implement fix', status: 'in_progress' },
      { text: 'Run tests', status: 'completed' },
    ]);

    expect(items).toEqual([
      { id: '1', text: 'Inspect current code', status: 'pending' },
      { id: 'b', text: 'Implement fix', status: 'in_progress' },
      { id: '3', text: 'Run tests', status: 'completed' },
    ]);
    expect(summarizeTaskPlan(items)).toEqual({
      totalCount: 3,
      completedCount: 1,
      inProgressCount: 1,
      pendingCount: 1,
    });
  });

  it('renders the visible task plan in Claude-style checklist form', () => {
    const rendered = renderTaskPlan([
      { id: '1', text: 'Inspect current code', status: 'pending' },
      { id: '2', text: 'Implement fix', status: 'in_progress' },
      { id: '3', text: 'Run tests', status: 'completed' },
    ]);

    expect(rendered).toBe(
      '[ ] #1: Inspect current code\n[>] #2: Implement fix\n[x] #3: Run tests\n\n(1/3 completed)'
    );
  });

  it('rejects multiple in-progress items', () => {
    expect(() =>
      normalizeTaskPlanItems([
        { text: 'A', status: 'in_progress' },
        { text: 'B', status: 'in_progress' },
      ])
    ).toThrow(/only one task can be in_progress/i);
  });

  it('rejects plans above the max size', () => {
    expect(() =>
      normalizeTaskPlanItems(
        Array.from({ length: MAX_TASK_PLAN_ITEMS + 1 }, (_value, index) => ({
          text: `Task ${index + 1}`,
        }))
      )
    ).toThrow(/max 20 todos allowed/i);
  });

  it('can enforce a tighter execution-plan cap for the chat todo tool', () => {
    expect(() =>
      normalizeTaskPlanItems(
        Array.from({ length: MAX_EXECUTION_TASK_PLAN_ITEMS + 1 }, (_value, index) => ({
          text: `Task ${index + 1}`,
        })),
        { maxItems: MAX_EXECUTION_TASK_PLAN_ITEMS }
      )
    ).toThrow(/max 5 todos allowed/i);
  });
});
