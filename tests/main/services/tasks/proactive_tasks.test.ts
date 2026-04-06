import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const NotificationMock = Object.assign(
    vi.fn(function NotificationCtor(this: { show: ReturnType<typeof vi.fn> }) {
      this.show = vi.fn();
    }),
    { isSupported: vi.fn(() => true) }
  );

  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
    Notification: NotificationMock,
    app: {
      isReady: vi.fn(() => true),
    },
  };
});

vi.mock('../../../../src/core/db/tasks', () => ({
  getProactiveTask: vi.fn(),
  updateProactiveTask: vi.fn(),
  listDueProactiveTasks: vi.fn(),
}));

vi.mock('../../../../src/core/db/chat_thread', () => ({
  touchChatThread: vi.fn(),
}));

vi.mock('../../../../src/daemon/bridge_dispatch', () => ({
  deliverBridgeThreadMessage: vi.fn(),
}));

vi.mock('../../../../src/main/services/presence/presence_runtime', () => ({
  recordPresenceRuntimeEvent: vi.fn(),
}));

vi.mock('../../../../src/main/services/chat/chat_service', () => ({
  chatService: {
    getThread: vi.fn(),
    createThread: vi.fn(),
    createMessage: vi.fn(),
    send: vi.fn(),
  },
}));

import { BrowserWindow, Notification } from 'electron';

import type { ProactiveTask } from '../../../../src/shared/types/tasks';
import { runProactiveTask } from '../../../../src/main/services/tasks/proactive_tasks';
import * as tasksDb from '../../../../src/core/db/tasks';
import * as chatThreadDb from '../../../../src/core/db/chat_thread';
import { deliverBridgeThreadMessage } from '../../../../src/daemon/bridge_dispatch';
import { chatService } from '../../../../src/main/services/chat/chat_service';
import { recordPresenceRuntimeEvent } from '../../../../src/main/services/presence/presence_runtime';

const baseTask = (overrides: Partial<ProactiveTask> = {}): ProactiveTask => ({
  id: 'task_1',
  name: 'Daily Brief',
  prompt: 'Summarize the latest updates.',
  schedule_type: 'interval',
  interval_minutes: 30,
  enabled: true,
  provider_type: 'openai',
  model: 'gpt-4',
  tool_mode: 'auto',
  tools: null,
  thread_id: null,
  notify: true,
  cron_expression: null,
  schedule_timezone: null,
  last_status: 'idle',
  created_at: '2026-03-18T00:00:00.000Z',
  updated_at: '2026-03-18T00:00:00.000Z',
  ...overrides,
});

const createDeferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('runProactiveTask', () => {
  const getProactiveTaskMock = vi.mocked(tasksDb.getProactiveTask);
  const updateProactiveTaskMock = vi.mocked(tasksDb.updateProactiveTask);
  const touchChatThreadMock = vi.mocked(chatThreadDb.touchChatThread);
  const deliverBridgeThreadMessageMock = vi.mocked(deliverBridgeThreadMessage);
  const recordPresenceRuntimeEventMock = vi.mocked(recordPresenceRuntimeEvent);
  const chatServiceMock = chatService as unknown as {
    getThread: ReturnType<typeof vi.fn>;
    createThread: ReturnType<typeof vi.fn>;
    createMessage: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deliverBridgeThreadMessageMock.mockResolvedValue({
      handled: false,
      delivered: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an error when the task is disabled for scheduled runs', async () => {
    getProactiveTaskMock.mockReturnValue(baseTask({ enabled: false }));

    const result = await runProactiveTask('task_1', { reason: 'schedule' });

    expect(result).toEqual({ success: false, error: 'Task is disabled' });
    expect(updateProactiveTaskMock).not.toHaveBeenCalled();
    expect(chatServiceMock.send).not.toHaveBeenCalled();
  });

  it('filters tools, creates a thread, and records success output', async () => {
    const sendMock = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } } as unknown as BrowserWindow,
    ]);

    getProactiveTaskMock.mockReturnValue(
      baseTask({
        tool_mode: 'manual',
        tools: JSON.stringify(['web', 'fetch', 'shell', 'read_file', 'list_dir', '']),
      })
    );
    chatServiceMock.getThread.mockReturnValue(null);
    chatServiceMock.createThread.mockReturnValue({ id: 'thread_1' });
    chatServiceMock.send.mockResolvedValue({ success: true, text: 'All good.' });

    const result = await runProactiveTask('task_1', { reason: 'manual' });

    expect(result).toEqual({ success: true });
    expect(updateProactiveTaskMock.mock.calls[0][1]).toEqual({
      last_status: 'running',
      last_error: null,
    });

    const toolCall = chatServiceMock.send.mock.calls[0][0];
    expect(toolCall.tools).toEqual(['web', 'fetch', 'read_file', 'list_dir']);
    expect(toolCall.threadId).toBe('thread_1');
    expect(toolCall.messages[0]).toMatchObject({
      role: 'system',
    });
    expect(toolCall.messages[1]).toMatchObject({
      role: 'user',
    });
    expect(toolCall.messages[1].content).toContain('Objective:\nSummarize the latest updates.');
    expect(toolCall.messages[1].content).toContain('Tool strategy: Manual safe tools');

    const threadUpdate = updateProactiveTaskMock.mock.calls.find(call => call[1]?.thread_id)?.[1];
    expect(threadUpdate?.thread_id).toBe('thread_1');

    const successUpdate = updateProactiveTaskMock.mock.calls.find(
      call => call[1]?.last_status === 'success'
    )?.[1];
    expect(successUpdate?.last_output).toBe('All good.');
    expect(successUpdate?.last_error).toBeNull();
    expect(typeof successUpdate?.last_run_at).toBe('string');
    expect(typeof successUpdate?.next_run_at).toBe('string');

    const messageMetaRaw = chatServiceMock.createMessage.mock.calls.at(-1)?.[0]?.metadata;
    const messageMeta = messageMetaRaw ? JSON.parse(messageMetaRaw) : null;
    expect(messageMeta).toMatchObject({
      source: 'proactive-task',
      taskId: 'task_1',
      kind: 'success',
      reason: 'manual',
    });

    expect(touchChatThreadMock).toHaveBeenCalledWith('thread_1');
    expect(recordPresenceRuntimeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task-started',
        taskId: 'task_1',
        threadId: 'thread_1',
      })
    );
    expect(recordPresenceRuntimeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task-finished',
        taskId: 'task_1',
        threadId: 'thread_1',
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      'tasks:push',
      expect.objectContaining({
        type: 'task-result',
        taskId: 'task_1',
        threadId: 'thread_1',
        status: 'success',
      })
    );
    expect(vi.mocked(Notification)).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit empty tool list when task tools are disabled', async () => {
    getProactiveTaskMock.mockReturnValue(
      baseTask({
        tool_mode: 'disabled',
      })
    );
    chatServiceMock.getThread.mockReturnValue(null);
    chatServiceMock.createThread.mockReturnValue({ id: 'thread_disabled' });
    chatServiceMock.send.mockResolvedValue({ success: true, text: 'No tools.' });

    await runProactiveTask('task_1', { reason: 'manual' });

    const toolCall = chatServiceMock.send.mock.calls[0][0];
    expect(toolCall.tools).toEqual([]);
    expect(toolCall.messages[1].content).toContain(
      'Tool strategy: Tools disabled; run as plain model reasoning only.'
    );
  });

  it('records failures and notifies when the task run fails', async () => {
    const sendMock = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } } as unknown as BrowserWindow,
    ]);

    getProactiveTaskMock.mockReturnValue(baseTask());
    chatServiceMock.getThread.mockReturnValue(null);
    chatServiceMock.createThread.mockReturnValue({ id: 'thread_2' });
    chatServiceMock.send.mockResolvedValue({ success: false, error: 'Boom' });

    const result = await runProactiveTask('task_1', { reason: 'manual' });

    expect(result).toEqual({ success: false, error: 'Boom' });

    const errorUpdate = updateProactiveTaskMock.mock.calls.find(
      call => call[1]?.last_status === 'error'
    )?.[1];
    expect(errorUpdate?.last_error).toBe('Boom');
    expect(errorUpdate?.last_output).toBeNull();

    const messageMetaRaw = chatServiceMock.createMessage.mock.calls.at(-1)?.[0]?.metadata;
    const messageMeta = messageMetaRaw ? JSON.parse(messageMetaRaw) : null;
    expect(messageMeta).toMatchObject({
      source: 'proactive-task',
      taskId: 'task_1',
      kind: 'error',
      reason: 'manual',
    });
    expect(recordPresenceRuntimeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task-failed',
        taskId: 'task_1',
        threadId: 'thread_2',
      })
    );

    expect(sendMock).toHaveBeenCalledWith(
      'tasks:push',
      expect.objectContaining({
        type: 'task-result',
        taskId: 'task_1',
        threadId: 'thread_2',
        status: 'error',
      })
    );
    expect(vi.mocked(Notification)).toHaveBeenCalledTimes(1);
  });

  it('computes next run times using cron schedules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T00:01:00.000Z'));

    getProactiveTaskMock.mockReturnValue(
      baseTask({
        schedule_type: 'cron',
        cron_expression: '*/5 * * * *',
        schedule_timezone: 'UTC',
      })
    );
    chatServiceMock.getThread.mockReturnValue(null);
    chatServiceMock.createThread.mockReturnValue({ id: 'thread_4' });
    chatServiceMock.send.mockResolvedValue({ success: true, text: 'ok' });

    await runProactiveTask('task_1', { reason: 'manual' });

    const successUpdate = updateProactiveTaskMock.mock.calls.find(
      call => call[1]?.last_status === 'success'
    )?.[1];
    expect(successUpdate?.next_run_at).toBe('2026-03-18T00:05:00.000Z');
  });

  it('delivers successful task output through bridge-owned threads', async () => {
    getProactiveTaskMock.mockReturnValue(
      baseTask({
        thread_id: 'napcat_10001_private_20002',
      })
    );
    chatServiceMock.getThread.mockReturnValue({
      id: 'napcat_10001_private_20002',
    });
    chatServiceMock.send.mockResolvedValue({ success: true, text: 'Bridge hello.' });
    deliverBridgeThreadMessageMock.mockResolvedValue({
      handled: true,
      delivered: true,
      source: 'napcat',
    });

    const result = await runProactiveTask('task_1', { reason: 'manual' });

    expect(result).toEqual({ success: true });
    expect(deliverBridgeThreadMessageMock).toHaveBeenCalledWith({
      threadId: 'napcat_10001_private_20002',
      text: expect.stringContaining('Bridge hello.'),
    });
  });

  it('marks the run as failed when bridge delivery fails', async () => {
    getProactiveTaskMock.mockReturnValue(
      baseTask({
        thread_id: 'napcat_10001_private_20002',
      })
    );
    chatServiceMock.getThread.mockReturnValue({
      id: 'napcat_10001_private_20002',
    });
    chatServiceMock.send.mockResolvedValue({ success: true, text: 'Bridge hello.' });
    deliverBridgeThreadMessageMock.mockResolvedValue({
      handled: true,
      delivered: false,
      source: 'napcat',
      error: 'NapCat bridge is not connected',
    });

    const result = await runProactiveTask('task_1', { reason: 'manual' });

    expect(result).toEqual({
      success: false,
      error: 'Failed to deliver napcat message: NapCat bridge is not connected',
    });

    const errorUpdate = updateProactiveTaskMock.mock.calls.find(
      call => call[1]?.last_status === 'error'
    )?.[1];
    expect(errorUpdate).toMatchObject({
      last_status: 'error',
      last_output: 'Bridge hello.',
      last_error: 'Failed to deliver napcat message: NapCat bridge is not connected',
    });

    const messageMetaRaw = chatServiceMock.createMessage.mock.calls.at(-1)?.[0]?.metadata;
    const messageMeta = messageMetaRaw ? JSON.parse(messageMetaRaw) : null;
    expect(messageMeta).toMatchObject({
      source: 'proactive-task',
      kind: 'error',
      stage: 'bridge-delivery',
      reason: 'manual',
    });
  });

  it('rejects overlapping runs while a task is already in flight', async () => {
    getProactiveTaskMock.mockReturnValue(baseTask());
    chatServiceMock.getThread.mockReturnValue(null);
    chatServiceMock.createThread.mockReturnValue({ id: 'thread_3' });

    const deferred = createDeferred<{ success: boolean; text: string }>();
    chatServiceMock.send.mockReturnValue(deferred.promise);

    const firstRun = runProactiveTask('task_1');
    const secondRun = await runProactiveTask('task_1');

    expect(secondRun).toEqual({ success: false, error: 'Task already running' });

    deferred.resolve({ success: true, text: 'done' });
    await firstRun;
  });
});
