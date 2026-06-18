import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProactiveTask } from '@iki/core/types/tasks';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const ipcHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('@iki/backend/db/tasks', () => ({
  getProactiveTasks: vi.fn(),
  getProactiveTask: vi.fn(),
  addProactiveTask: vi.fn(),
  updateProactiveTask: vi.fn(),
  deleteProactiveTask: vi.fn(),
}));

vi.mock('../../../packages/desktop/src/main/services/tasks/proactive_tasks', () => ({
  runProactiveTask: vi.fn(),
}));

import { registerTasksIpc } from '../../../packages/desktop/src/main/ipc/tasks';
import * as tasksDb from '@iki/backend/db/tasks';
import { runProactiveTask } from '../../../packages/desktop/src/main/services/tasks/proactive_tasks';

const addProactiveTaskMock = vi.mocked(tasksDb.addProactiveTask);
const getProactiveTaskMock = vi.mocked(tasksDb.getProactiveTask);
const updateProactiveTaskMock = vi.mocked(tasksDb.updateProactiveTask);
const deleteProactiveTaskMock = vi.mocked(tasksDb.deleteProactiveTask);
const runProactiveTaskMock = vi.mocked(runProactiveTask);

const createStoredTask = (overrides: Partial<ProactiveTask> = {}): ProactiveTask => ({
  id: 'task_default',
  name: 'Daily',
  prompt: 'Summarize',
  schedule_type: 'interval',
  interval_minutes: 60,
  cron_expression: null,
  schedule_timezone: null,
  enabled: true,
  provider_type: 'openai',
  provider_id: null,
  model: 'gpt-4',
  tool_mode: 'auto',
  tools: null,
  thread_id: null,
  notify: true,
  last_run_at: null,
  next_run_at: null,
  last_status: 'idle',
  last_output: null,
  last_error: null,
  created_at: '2026-03-18T00:00:00.000Z',
  updated_at: '2026-03-18T00:00:00.000Z',
  ...overrides,
});

beforeAll(() => {
  registerTasksIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
  addProactiveTaskMock.mockReset();
  getProactiveTaskMock.mockReset();
  updateProactiveTaskMock.mockReset();
  deleteProactiveTaskMock.mockReset();
  runProactiveTaskMock.mockReset();
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

    const createdTask = createStoredTask({ id: 'task_created' });
    getProactiveTaskMock.mockReturnValue(createdTask);

    const result = await handler(null, {
      name: '  Daily  ',
      prompt: '  Summarize  ',
      provider_type: ' openai ',
      provider_id: ' provider_primary ',
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
    expect(params.provider_id).toBe('provider_primary');
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

    getProactiveTaskMock.mockReturnValue(createStoredTask({ id: 'task_cron' }));

    const result = await handler(null, {
      name: 'Cron Task',
      prompt: 'Ping',
      provider_type: 'openai',
      model: 'gpt-4',
      schedule_type: 'cron',
      cron_expression: '0 2 * * *',
      schedule_timezone: 'UTC',
    });

    expect(result).toEqual({
      success: true,
      task: expect.objectContaining({ id: 'task_cron' }),
    });

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
        ...createStoredTask({ id: 'task_proxy', name: 'Daily' }),
        tools: ['web', 'fetch'],
      },
      {}
    );
    getProactiveTaskMock.mockReturnValue(proxiedTask as unknown as ProactiveTask);

    const result = await handler(null, {
      name: 'Daily',
      prompt: 'Summarize',
      provider_type: 'deepseek',
      model: 'deepseek-chat',
    });

    expect(result).toEqual({
      success: true,
      task: expect.objectContaining({
        id: 'task_proxy',
        name: 'Daily',
        tools: ['web', 'fetch'],
      }),
    });
    expect(() => structuredClone(result)).not.toThrow();
  });

  it('recomputes next_run_at when interval changes on an enabled task', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

    const handler = ipcHandlers.get('tasks:update');
    if (!handler) throw new Error('tasks:update handler not registered');

    getProactiveTaskMock.mockReturnValue(
      createStoredTask({
        id: 'task_1',
        enabled: true,
        interval_minutes: 30,
      })
    );

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

    getProactiveTaskMock.mockReturnValue(createStoredTask({ id: 'task_disabled' }));

    const result = await handler(null, {
      name: 'No Tools',
      prompt: 'Summarize without tools',
      provider_type: 'openai',
      model: 'gpt-4',
      tool_mode: 'disabled',
      tools: [],
    });

    expect(result).toEqual({
      success: true,
      task: expect.objectContaining({ id: 'task_disabled' }),
    });

    const params = addProactiveTaskMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.tool_mode).toBe('disabled');
    expect(params.tools).toBe('[]');
  });

  it('recomputes next_run_at when cron expression changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T05:10:00.000Z'));

    const handler = ipcHandlers.get('tasks:update');
    if (!handler) throw new Error('tasks:update handler not registered');

    getProactiveTaskMock.mockReturnValue(
      createStoredTask({
        id: 'task_cron',
        enabled: true,
        interval_minutes: 60,
        schedule_type: 'cron',
        cron_expression: '0 5 * * *',
        schedule_timezone: 'UTC',
      })
    );

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

    getProactiveTaskMock.mockReturnValue(
      createStoredTask({
        id: 'task_2',
        enabled: false,
        interval_minutes: 45,
      })
    );

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

  it('wraps task run errors instead of letting them propagate to IPC', async () => {
    const handler = ipcHandlers.get('tasks:run-now');
    if (!handler) throw new Error('tasks:run-now handler not registered');

    runProactiveTaskMock.mockRejectedValueOnce(new Error('provider offline'));

    const result = await handler(null, 'task_3');

    expect(result).toEqual({ success: false, error: 'provider offline' });
  });

  it('removes tasks through the delete handler', async () => {
    const handler = ipcHandlers.get('tasks:delete');
    if (!handler) throw new Error('tasks:delete handler not registered');

    getProactiveTaskMock.mockReturnValue(createStoredTask({ id: 'task_4', name: 'Daily' }));
    deleteProactiveTaskMock.mockReturnValue(
      { changes: 1 } as unknown as ReturnType<typeof tasksDb.deleteProactiveTask>
    );

    const result = await handler(null, 'task_4');

    expect(deleteProactiveTaskMock).toHaveBeenCalledWith('task_4');
    expect(result).toEqual({ success: true });
  });
});
