// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { registerBridgeThreadSender } from '@iki/backend/bridge_dispatch';
import { addChatMessage, getChatMessages } from '@iki/backend/db/chat_message';
import { addChatThread, touchChatThread as touchThread } from '@iki/backend/db/chat_thread';
import { getProactiveTask } from '@iki/backend/db/tasks';
import {
  createProactiveTaskRunner,
  type TaskRunnerChatPort,
  type TaskRunnerHostPort,
} from '@iki/backend/tasks/proactive_task_runner';
import { createProactiveTask } from '@iki/backend/tasks/proactive_task_manager';

let dataDir = '';
let threadSeq = 0;

// Stage E: the proactive-task execution business runs in backend with a fake
// chat service and a fake host — impossible while it lived in the Electron
// process. The run drives a real SQLite task row through the full lifecycle:
// thread creation, prompt delivery, result persistence, host notifications.
describe('proactive task runner (backend)', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-task-runner-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'runner.db') });
    // The task thread's metadata source registers it for bridge delivery.
    registerBridgeThreadSender('proactive-task', async () => undefined);
  });

  afterAll(async () => {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  const buildRunner = (options?: {
    sendResult?: { success: boolean; error?: string; text?: string };
  }) => {
    const sentRequests: Array<Record<string, unknown>> = [];
    const createdMessages: Array<Record<string, unknown>> = [];
    const createdThreads: Array<{ title: string; model: string | null }> = [];
    const notifications: Array<{ title: string; body: string }> = [];
    const pushedEvents: unknown[] = [];
    const nudges: Array<{ kind: string; taskName: string }> = [];

    const chat: TaskRunnerChatPort = {
      getThread: threadId => (threadId === 'thread_existing' ? { id: threadId } : null),
      // 'thread_existing' is backed by a real row for the concurrency test.
      createThread: input => {
        createdThreads.push(input);
        // FKs downstream (task.thread_id, messages) need a real thread row.
        const threadId = `thread_${++threadSeq}`;
        addChatThread({
          id: threadId,
          title: input.title,
          model: input.model ?? null,
          metadata: input.metadata ?? '{}',
        });
        return { id: threadId };
      },
      createMessage: input => {
        createdMessages.push(input as Record<string, unknown>);
        // Persist for real: the runner's rows must satisfy the thread FK.
        const row = input as {
          id: string;
          thread_id: string;
          message: string;
          timestamp: string;
          metadata: string;
          parent_id?: string;
          depth?: number;
        };
        addChatMessage({
          id: row.id,
          thread_id: row.thread_id,
          parent_id: row.parent_id ?? null,
          depth: row.depth ?? 0,
          message: row.message,
          timestamp: row.timestamp,
          metadata: row.metadata,
        });
        return input;
      },
      send: (async (options: unknown) => {
        sentRequests.push(options as Record<string, unknown>);
        return options?.sendResult ?? { success: true, text: 'task output text' };
      }) as unknown as TaskRunnerChatPort['send'],
    };
    const host: TaskRunnerHostPort = {
      notify: params => notifications.push(params),
      pushTaskEvent: payload => pushedEvents.push(payload),
      pushTaskNudge: nudge => nudges.push(nudge),
    };
    void options;
    const runner = createProactiveTaskRunner({ chat, host });
    return {
      runner,
      chat,
      sentRequests,
      createdMessages,
      createdThreads,
      notifications,
      pushedEvents,
      nudges,
    };
  };

  it('runs a due task end-to-end: thread, prompt, result persistence, host signals', async () => {
    createProactiveTask({
      id: 'task_run',
      name: 'Nightly digest',
      prompt: 'Summarize the news',
      provider_type: 'openai',
      model: 'test-model',
      interval_minutes: 30,
      notify: true,
    });

    const deps = buildRunner();
    const result = await deps.runner.runProactiveTask('task_run', { reason: 'schedule' });
    expect(result).toMatchObject({ success: true });

    // The task row advanced through its lifecycle.
    const task = getProactiveTask('task_run')!;
    expect(task.last_status).toBe('success');
    expect(task.last_output).toContain('task output text');
    expect(task.last_error).toBeNull();
    expect(task.next_run_at).toBeTruthy();
    expect(task.thread_id).toMatch(/^thread_/);

    // The prompt carried the objective and the run bookkeeping.
    const request = deps.sentRequests[0]!;
    const promptText = JSON.stringify(request.messages);
    expect(promptText).toContain('Summarize the news');
    expect(promptText).toContain('Nightly digest');
    expect(promptText).toContain('Run reason: schedule');
    expect((request.runConfig as { kind: string }).kind).toBe('proactive-task');

    // Result and intro messages persisted into the task thread.
    const messages = getChatMessages(task.thread_id!);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(messages.map(row => row.message))).toContain('task output text');

    // Host signals fired: notification, push event, success nudge.
    expect(deps.notifications).toEqual([
      expect.objectContaining({ title: expect.stringContaining('Task finished') }),
    ]);
    expect(deps.pushedEvents).toHaveLength(1);
    expect(deps.nudges).toEqual([{ kind: 'task-success', taskName: 'Nightly digest' }]);
  });

  it('records the failure path: status, error message, error nudge', async () => {
    createProactiveTask({
      id: 'task_fail',
      name: 'Failing task',
      prompt: 'boom',
      provider_type: 'openai',
      model: 'test-model',
      interval_minutes: 30,
      notify: true,
    });

    const deps = buildRunner();
    (deps.chat.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce?.({
      success: false,
      error: 'provider exploded',
    });
    // The port is a plain object — replace send for this runner instance.
    const failingRunner = createProactiveTaskRunner({
      chat: {
        ...deps.chat,
        send: async () => ({ success: false, error: 'provider exploded' }),
      },
      host: {
        notify: params => deps.notifications.push(params),
        pushTaskEvent: payload => deps.pushedEvents.push(payload),
        pushTaskNudge: nudge => deps.nudges.push(nudge),
      },
    });

    const result = await failingRunner.runProactiveTask('task_fail', { reason: 'schedule' });
    if (result.error !== 'provider exploded') {
      // eslint-disable-next-line no-console
      console.log('T2-ERR:', result.error);
    }
    expect(result).toMatchObject({ success: false, error: 'provider exploded' });

    const task = getProactiveTask('task_fail')!;
    expect(task.last_status).toBe('error');
    expect(task.last_error).toBe('provider exploded');

    // An error message landed in the thread and the host was told.
    const messages = getChatMessages(task.thread_id!);
    expect(JSON.stringify(messages.map(row => row.message))).toContain('provider exploded');
    expect(deps.notifications).toEqual([
      expect.objectContaining({ title: expect.stringContaining('Task failed') }),
    ]);
    expect(deps.nudges).toEqual([{ kind: 'task-error', taskName: 'Failing task' }]);
  });

  it('refuses a second concurrent run of the same task', async () => {
    createProactiveTask({
      id: 'task_concurrent',
      name: 'Slow task',
      prompt: 'slow',
      provider_type: 'openai',
      model: 'test-model',
      interval_minutes: 30,
    });

    addChatThread({
      id: 'thread_existing',
      title: 'existing',
      metadata: '{}',
    });
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const runner = createProactiveTaskRunner({
      chat: {
        getThread: () => ({ id: 'thread_existing' }),
        createThread: () => {
          // FK: the runner writes task.thread_id back — a real row required.
          const threadId = `thread_new_${Date.now()}`;
          addChatThread({ id: threadId, title: 'created', metadata: '{}' });
          return { id: threadId };
        },
        createMessage: (input: unknown) => {
          const row = input as {
            id: string;
            thread_id: string;
            message: string;
            timestamp: string;
            metadata: string;
          };
          addChatMessage({
            id: row.id,
            thread_id: row.thread_id,
            parent_id: null,
            depth: 0,
            message: row.message,
            timestamp: row.timestamp,
            metadata: row.metadata,
          });
          return input;
        },
        send: (async () => {
          await gate;
          return { success: true, text: 'slow output' };
        }) as unknown as TaskRunnerChatPort['send'],
      },
      host: {},
    });

    const first = runner.runProactiveTask('task_concurrent', { reason: 'schedule' });
    const second = await runner.runProactiveTask('task_concurrent', { reason: 'schedule' });
    if (second.error !== 'Task already running') {
      // eslint-disable-next-line no-console
      console.log('T3-ERR:', second.error);
    }
    expect(second).toMatchObject({ success: false, error: 'Task already running' });
    release();
    const firstResult = await first;
    expect(firstResult).toMatchObject({ success: true });
  });
});
