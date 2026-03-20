import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../src/core/db/tasks', () => ({
  getProactiveTasks: vi.fn(),
  getProactiveTask: vi.fn(),
  addProactiveTask: vi.fn(),
  updateProactiveTask: vi.fn(),
  deleteProactiveTask: vi.fn(),
}));

vi.mock('../../../src/main/services/tasks/proactive_tasks', () => ({
  runProactiveTask: vi.fn(),
}));

import { registerTasksIpc } from '../../../src/main/ipc/tasks';
import * as tasksDb from '../../../src/core/db/tasks';
import { runProactiveTask } from '../../../src/main/services/tasks/proactive_tasks';

const addProactiveTaskMock = vi.mocked(tasksDb.addProactiveTask);
const getProactiveTaskMock = vi.mocked(tasksDb.getProactiveTask);
const updateProactiveTaskMock = vi.mocked(tasksDb.updateProactiveTask);
const deleteProactiveTaskMock = vi.mocked(tasksDb.deleteProactiveTask);
const runProactiveTaskMock = vi.mocked(runProactiveTask);

beforeAll(() => {
  registerTasksIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tasks IPC', () => {
  it('creates tasks with normalized fields and clamped interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:00:00.000Z'));

    const handler = ipcHandlers.get('tasks:create');
    if (!handler) throw new Error('tasks:create handler not registered');

    const createdTask = { id: 'task_created' };
    getProactiveTaskMock.mockReturnValue(createdTask as any);

    const result = await handler(null, {
      name: '  Daily  ',
      prompt: '  Summarize  ',
      provider_type: ' openai ',
      model: ' gpt-4 ',
      interval_minutes: 0,
      tools: ['web', ' fetch ', ''],
      thread_id: '   ',
    });

    expect(result).toEqual({ success: true, task: createdTask });

    const params = addProactiveTaskMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.name).toBe('Daily');
    expect(params.prompt).toBe('Summarize');
    expect(params.provider_type).toBe('openai');
    expect(params.model).toBe('gpt-4');
    expect(params.enabled).toBe(true);
    expect(params.notify).toBe(true);
    expect(params.interval_minutes).toBe(1);
    expect(params.schedule_type).toBe('interval');
    expect(params.cron_expression).toBeNull();
    expect(params.schedule_timezone).toBeNull();
    expect(params.tool_mode).toBe('manual');
    expect(params.tools).toBe('["web","fetch"]');
    expect(params.thread_id).toBeNull();
    expect(params.next_run_at).toBe('2026-03-18T12:01:00.000Z');
    expect(typeof params.id).toBe('string');
    expect((params.id as string).startsWith('task_')).toBe(true);
  });

  it('creates cron tasks and computes next run time from the expression', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T01:23:00.000Z'));

    const handler = ipcHandlers.get('tasks:create');
    if (!handler) throw new Error('tasks:create handler not registered');

    getProactiveTaskMock.mockReturnValue({ id: 'task_cron' } as any);

    const result = await handler(null, {
      name: 'Cron Task',
      prompt: 'Ping',
      provider_type: 'openai',
      model: 'gpt-4',
      schedule_type: 'cron',
      cron_expression: '0 2 * * *',
      schedule_timezone: 'UTC',
    });

    expect(result).toEqual({ success: true, task: { id: 'task_cron' } });

    const params = addProactiveTaskMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.schedule_type).toBe('cron');
    expect(params.cron_expression).toBe('0 2 * * *');
    expect(params.schedule_timezone).toBe('UTC');
    expect(params.next_run_at).toBe('2026-03-18T02:00:00.000Z');
  });

  it('rejects create when required fields are missing', async () => {
    const handler = ipcHandlers.get('tasks:create');
    if (!handler) throw new Error('tasks:create handler not registered');

    const result = await handler(null, {
      prompt: 'hello',
      provider_type: 'openai',
      model: 'gpt-4',
    });

    expect(result).toEqual({ success: false, error: 'Task name is required' });
    expect(addProactiveTaskMock).not.toHaveBeenCalled();
  });

  it('serializes create responses before returning them over IPC', async () => {
    const handler = ipcHandlers.get('tasks:create');
    if (!handler) throw new Error('tasks:create handler not registered');

    const proxiedTask = new Proxy(
      {
        id: 'task_proxy',
        name: 'Daily',
        tools: ['web', 'fetch'],
      },
      {}
    );
    getProactiveTaskMock.mockReturnValue(proxiedTask as any);

    const result = await handler(null, {
      name: 'Daily',
      prompt: 'Summarize',
      provider_type: 'deepseek',
      model: 'deepseek-chat',
    });

    expect(result).toEqual({
      success: true,
      task: {
        id: 'task_proxy',
        name: 'Daily',
        tools: ['web', 'fetch'],
      },
    });
    expect(() => structuredClone(result)).not.toThrow();
  });

  it('recomputes next_run_at when interval changes on an enabled task', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

    const handler = ipcHandlers.get('tasks:update');
    if (!handler) throw new Error('tasks:update handler not registered');

    getProactiveTaskMock.mockReturnValue({
      id: 'task_1',
      enabled: true,
      interval_minutes: 30,
    } as any);

    await handler(null, 'task_1', { interval_minutes: 90, tools: 'web' });

    const params = updateProactiveTaskMock.mock.calls[0][1] as Record<string, unknown>;
    expect(params.interval_minutes).toBe(90);
    expect(params.tool_mode).toBe('manual');
    expect(params.tools).toBe('["web"]');
    expect(params.next_run_at).toBe('2026-03-18T11:30:00.000Z');
  });

  it('supports explicitly disabling tools for proactive tasks', async () => {
    const handler = ipcHandlers.get('tasks:create');
    if (!handler) throw new Error('tasks:create handler not registered');

    getProactiveTaskMock.mockReturnValue({ id: 'task_disabled' } as any);

    const result = await handler(null, {
      name: 'No Tools',
      prompt: 'Summarize without tools',
      provider_type: 'openai',
      model: 'gpt-4',
      tool_mode: 'disabled',
      tools: [],
    });

    expect(result).toEqual({ success: true, task: { id: 'task_disabled' } });

    const params = addProactiveTaskMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.tool_mode).toBe('disabled');
    expect(params.tools).toBe('[]');
  });

  it('recomputes next_run_at when cron expression changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T05:10:00.000Z'));

    const handler = ipcHandlers.get('tasks:update');
    if (!handler) throw new Error('tasks:update handler not registered');

    getProactiveTaskMock.mockReturnValue({
      id: 'task_cron',
      enabled: true,
      interval_minutes: 60,
      schedule_type: 'cron',
      cron_expression: '0 5 * * *',
      schedule_timezone: 'UTC',
    } as any);

    await handler(null, 'task_cron', { cron_expression: '0 6 * * *' });

    const params = updateProactiveTaskMock.mock.calls[0][1] as Record<string, unknown>;
    expect(params.cron_expression).toBe('0 6 * * *');
    expect(params.next_run_at).toBe('2026-03-18T06:00:00.000Z');
  });

  it('schedules next_run_at when enabling a previously disabled task', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T09:00:00.000Z'));

    const handler = ipcHandlers.get('tasks:update');
    if (!handler) throw new Error('tasks:update handler not registered');

    getProactiveTaskMock.mockReturnValue({
      id: 'task_2',
      enabled: false,
      interval_minutes: 45,
    } as any);

    await handler(null, 'task_2', { enabled: true });

    const params = updateProactiveTaskMock.mock.calls[0][1] as Record<string, unknown>;
    expect(params.enabled).toBe(true);
    expect(params.next_run_at).toBe('2026-03-18T09:45:00.000Z');
  });

  it('forwards manual run requests to the task runner', async () => {
    const handler = ipcHandlers.get('tasks:run-now');
    if (!handler) throw new Error('tasks:run-now handler not registered');

    runProactiveTaskMock.mockResolvedValue({ success: true });

    const result = await handler(null, 'task_3');

    expect(runProactiveTaskMock).toHaveBeenCalledWith('task_3', { reason: 'manual' });
    expect(result).toEqual({ success: true });
  });

  it('removes tasks through the delete handler', async () => {
    const handler = ipcHandlers.get('tasks:delete');
    if (!handler) throw new Error('tasks:delete handler not registered');

    deleteProactiveTaskMock.mockReturnValue({ changes: 1 } as any);

    const result = await handler(null, 'task_4');

    expect(deleteProactiveTaskMock).toHaveBeenCalledWith('task_4');
    expect(result).toEqual({ success: true });
  });
});
