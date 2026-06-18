import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/core/db/tasks', () => ({
  addProactiveTask: vi.fn(),
  deleteProactiveTask: vi.fn(),
  getProactiveTask: vi.fn(),
  getProactiveTasks: vi.fn(),
  updateProactiveTask: vi.fn(),
}));

import * as tasksDb from '@iki/core/db/tasks';
import type { ProactiveTask } from '@iki/core/types/tasks';
import {
  createProactiveTask,
  deleteProactiveTask,
  listProactiveTaskRecords,
  readProactiveTaskRecord,
  updateProactiveTask,
} from '@iki/core/tasks/proactive_task_manager';

const createTask = (overrides: Partial<ProactiveTask> = {}): ProactiveTask => ({
  id: 'task_1',
  name: 'Daily Gold',
  prompt: 'Summarize the latest gold price.',
  schedule_type: 'interval',
  interval_minutes: 30,
  cron_expression: null,
  schedule_timezone: null,
  enabled: true,
  provider_type: 'openai',
  provider_id: 'provider_primary',
  model: 'gpt-4o-mini',
  tool_mode: 'auto',
  tools: null,
  thread_id: 'thread_1',
  notify: true,
  last_run_at: null,
  next_run_at: '2026-03-18T08:30:00.000Z',
  last_status: 'idle',
  last_output: null,
  last_error: null,
  created_at: '2026-03-18T08:00:00.000Z',
  updated_at: '2026-03-18T08:00:00.000Z',
  ...overrides,
});

describe('proactive_task_manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('creates tasks with normalized provider identity, safe tools, and computed next run time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T01:23:00.000Z'));

    vi.mocked(tasksDb.getProactiveTask).mockReturnValue(createTask({ id: 'task_created' }));

    const task = createProactiveTask({
      name: '  Daily Gold  ',
      prompt: '  Summarize the latest gold price.  ',
      provider_type: ' openai ',
      provider_id: ' provider_primary ',
      model: ' gpt-4o-mini ',
      schedule_type: 'cron',
      cron_expression: '0 2 * * *',
      schedule_timezone: 'UTC',
      tool_mode: 'manual',
      tools: ['web', ' fetch ', ''],
    });

    expect(task.id).toBe('task_created');
    expect(tasksDb.addProactiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Daily Gold',
        prompt: 'Summarize the latest gold price.',
        provider_type: 'openai',
        provider_id: 'provider_primary',
        model: 'gpt-4o-mini',
        tool_mode: 'manual',
        tools: '["web","fetch"]',
        next_run_at: '2026-03-18T02:00:00.000Z',
      })
    );
  });

  it('updates tasks by exact name and recomputes next_run_at when an enabled schedule changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

    vi.mocked(tasksDb.getProactiveTasks).mockReturnValue([
      createTask({
        id: 'task_by_name',
        name: 'Daily Gold',
        enabled: false,
        interval_minutes: 30,
        tools: null,
      }),
    ]);
    vi.mocked(tasksDb.getProactiveTask).mockReturnValue(
      createTask({
        id: 'task_by_name',
        name: 'Daily Gold',
        enabled: true,
        interval_minutes: 90,
        provider_id: null,
        tool_mode: 'manual',
        tools: '["web"]',
      })
    );

    const updated = updateProactiveTask(
      { name: 'Daily Gold' },
      {
        enabled: true,
        interval_minutes: 90,
        provider_id: null,
        tools: 'web',
      }
    );

    expect(updated.id).toBe('task_by_name');
    expect(tasksDb.updateProactiveTask).toHaveBeenCalledWith(
      'task_by_name',
      expect.objectContaining({
        enabled: true,
        interval_minutes: 90,
        provider_id: null,
        tool_mode: 'manual',
        tools: '["web"]',
        next_run_at: '2026-03-18T11:30:00.000Z',
      })
    );
  });

  it('returns summarized records for list/read and forwards deletes by task reference', () => {
    vi.mocked(tasksDb.getProactiveTasks).mockReturnValue([
      createTask({
        id: 'task_summary',
        name: 'Daily Gold',
        schedule_type: 'cron',
        cron_expression: '0 9 * * *',
        schedule_timezone: 'Asia/Shanghai',
        tool_mode: 'manual',
        tools: '["web","fetch"]',
      }),
    ]);

    const list = listProactiveTaskRecords({ query: 'gold', limit: 5 });
    expect(list[0]).toEqual(
      expect.objectContaining({
        id: 'task_summary',
        tools: ['web', 'fetch'],
        schedule_summary: '0 9 * * * (Asia/Shanghai)',
        tool_summary: 'Manual safe tools: web, fetch',
      })
    );

    const read = readProactiveTaskRecord({ name: 'Daily Gold' });
    expect(read?.id).toBe('task_summary');

    expect(deleteProactiveTask({ name: 'Daily Gold' })).toEqual({
      deleted: true,
      taskId: 'task_summary',
      taskName: 'Daily Gold',
    });
    expect(tasksDb.deleteProactiveTask).toHaveBeenCalledWith('task_summary');
  });
});
