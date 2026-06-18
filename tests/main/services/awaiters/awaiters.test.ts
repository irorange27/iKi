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

vi.mock('../../../../src/core/db/awaiters', () => ({
  addAwaiterWakeEvent: vi.fn(),
  getAwaiter: vi.fn(),
  listDueAwaiters: vi.fn(),
  updateAwaiter: vi.fn(),
  updateAwaiterIfStatus: vi.fn(() => ({ changes: 1 })),
}));

vi.mock('../../../../src/core/db/chat_thread', () => ({
  touchChatThread: vi.fn(),
}));

vi.mock('../../../../src/daemon/bridge_dispatch', () => ({
  deliverBridgeThreadMessage: vi.fn(),
}));

vi.mock('../../../../src/core/db/agent_runs', () => ({
  getAgentRun: vi.fn(() => null),
  getLatestAgentRunCheckpoint: vi.fn(() => null),
}));

vi.mock('../../../../src/main/services/chat/service', () => ({
  chatService: {
    getThread: vi.fn(),
    createMessage: vi.fn(),
    send: vi.fn(),
  },
}));

import { BrowserWindow, Notification } from 'electron';

import type { Awaiter } from '../../../../src/shared/types/awaiters';
import {
  runAwaiterWake,
  startAwaiterScheduler,
  stopAwaiterScheduler,
} from '../../../../src/main/services/awaiters/awaiters';
import * as awaitersDb from '../../../../src/core/db/awaiters';
import * as chatThreadDb from '../../../../src/core/db/chat_thread';
import { deliverBridgeThreadMessage } from '../../../../src/daemon/bridge_dispatch';
import { chatService } from '../../../../src/main/services/chat/service';

const baseAwaiter = (overrides: Partial<Awaiter> = {}): Awaiter => ({
  id: 'awaiter_1',
  title: 'Resume Draft',
  instruction: 'Continue the draft tomorrow morning.',
  status: 'armed',
  thread_id: 'thread_1',
  origin_run_id: 'run_origin',
  origin_checkpoint_id: null,
  trigger_kind: 'time_after',
  trigger_spec_json: '{"kind":"time_after","delay_minutes":30}',
  delivery_mode: 'thread',
  notify: true,
  provider_type: 'openai',
  provider_id: 'provider_primary',
  model: 'gpt-5.4',
  resume_context_json: null,
  next_wake_at: '2026-04-23T06:30:00.000Z',
  last_wake_at: null,
  last_error: null,
  expires_at: null,
  created_at: '2026-04-23T06:00:00.000Z',
  updated_at: '2026-04-23T06:00:00.000Z',
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

describe('runAwaiterWake', () => {
  const getAwaiterMock = vi.mocked(awaitersDb.getAwaiter);
  const listDueAwaitersMock = vi.mocked(awaitersDb.listDueAwaiters);
  const updateAwaiterMock = vi.mocked(awaitersDb.updateAwaiter);
  const updateAwaiterIfStatusMock = vi.mocked(awaitersDb.updateAwaiterIfStatus);
  const addAwaiterWakeEventMock = vi.mocked(awaitersDb.addAwaiterWakeEvent);
  const touchChatThreadMock = vi.mocked(chatThreadDb.touchChatThread);
  const deliverBridgeThreadMessageMock = vi.mocked(deliverBridgeThreadMessage);
  const chatServiceMock = chatService as unknown as {
    getThread: ReturnType<typeof vi.fn>;
    createMessage: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    updateAwaiterIfStatusMock.mockReturnValue({ changes: 1 } as { changes: number });
    deliverBridgeThreadMessageMock.mockResolvedValue({
      handled: false,
      delivered: false,
    });
  });

  afterEach(() => {
    stopAwaiterScheduler();
    vi.useRealTimers();
  });

  it('records successful wakes, links the new run id, and notifies renderers', async () => {
    const sendMock = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } } as unknown as BrowserWindow,
    ]);

    getAwaiterMock
      .mockReturnValueOnce(baseAwaiter())
      .mockReturnValueOnce(baseAwaiter({ status: 'waking' }))
      .mockReturnValue(baseAwaiter({ status: 'completed', next_wake_at: null }));
    chatServiceMock.getThread.mockReturnValue({ id: 'thread_1' });
    chatServiceMock.send.mockResolvedValue({
      success: true,
      text: 'Wake complete.',
      runId: 'run_wake_1',
    });

    const result = await runAwaiterWake('awaiter_1');

    expect(result).toEqual({ success: true, runId: 'run_wake_1' });
    expect(updateAwaiterMock.mock.calls[0]?.[1]).toEqual({
      status: 'waking',
      last_error: null,
    });
    expect(updateAwaiterIfStatusMock).toHaveBeenCalledWith('awaiter_1', 'waking', {
      status: 'completed',
      last_wake_at: expect.any(String),
      last_error: null,
      next_wake_at: null,
    });
    expect(updateAwaiterIfStatusMock.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({
        status: 'completed',
        last_error: null,
        next_wake_at: null,
      })
    );

    expect(chatServiceMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'provider_primary',
        threadId: 'thread_1',
        runConfig: {
          kind: 'awaiter-wake',
          parentRunId: 'run_origin',
          metadata: {
            source: 'awaiter',
            awaiterId: 'awaiter_1',
            originRunId: 'run_origin',
            triggerKind: 'time_after',
          },
        },
      })
    );
    expect(deliverBridgeThreadMessageMock).toHaveBeenCalledWith({
      threadId: 'thread_1',
      text: expect.stringContaining('Wake complete.'),
    });
    expect(addAwaiterWakeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        awaiter_id: 'awaiter_1',
        run_id: 'run_wake_1',
        outcome: 'success',
      })
    );

    const messageMetaRaw = chatServiceMock.createMessage.mock.calls.at(-1)?.[0]?.metadata;
    const messageMeta = messageMetaRaw ? JSON.parse(messageMetaRaw) : null;
    expect(messageMeta).toMatchObject({
      source: 'awaiter',
      awaiterId: 'awaiter_1',
      kind: 'success',
      runId: 'run_wake_1',
    });

    expect(touchChatThreadMock).toHaveBeenCalledWith('thread_1');
    expect(sendMock).toHaveBeenCalledWith(
      'awaiters:push',
      expect.objectContaining({
        type: 'awaiter-result',
        awaiterId: 'awaiter_1',
        threadId: 'thread_1',
        status: 'completed',
      })
    );
    expect(vi.mocked(Notification)).toHaveBeenCalledTimes(1);
  });

  it('records failed wakes and preserves the failed wake run id when send() returns one', async () => {
    const sendMock = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } } as unknown as BrowserWindow,
    ]);

    getAwaiterMock
      .mockReturnValueOnce(baseAwaiter())
      .mockReturnValueOnce(baseAwaiter({ status: 'waking' }))
      .mockReturnValue(baseAwaiter({ status: 'failed', next_wake_at: null, last_error: 'Boom' }));
    chatServiceMock.getThread.mockReturnValue({ id: 'thread_1' });
    chatServiceMock.send.mockResolvedValue({
      success: false,
      error: 'Boom',
      runId: 'run_failed_1',
    });

    const result = await runAwaiterWake('awaiter_1');

    expect(result).toEqual({
      success: false,
      error: 'Boom',
      runId: 'run_failed_1',
    });
    expect(updateAwaiterIfStatusMock.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({
        status: 'failed',
        last_error: 'Boom',
        next_wake_at: null,
      })
    );
    expect(addAwaiterWakeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        awaiter_id: 'awaiter_1',
        run_id: 'run_failed_1',
        outcome: 'error',
        error: 'Boom',
      })
    );

    const messageMetaRaw = chatServiceMock.createMessage.mock.calls.at(-1)?.[0]?.metadata;
    const messageMeta = messageMetaRaw ? JSON.parse(messageMetaRaw) : null;
    expect(messageMeta).toMatchObject({
      source: 'awaiter',
      awaiterId: 'awaiter_1',
      kind: 'error',
      runId: 'run_failed_1',
    });

    expect(sendMock).toHaveBeenCalledWith(
      'awaiters:push',
      expect.objectContaining({
        type: 'awaiter-result',
        awaiterId: 'awaiter_1',
        threadId: 'thread_1',
        status: 'failed',
      })
    );
  });

  it('persists an audit row when the target thread is unavailable', async () => {
    getAwaiterMock.mockReturnValue(baseAwaiter());
    chatServiceMock.getThread.mockReturnValue(null);

    const result = await runAwaiterWake('awaiter_1');

    expect(result).toEqual({
      success: false,
      error: 'Target thread is unavailable',
    });
    expect(updateAwaiterMock).toHaveBeenCalledWith(
      'awaiter_1',
      expect.objectContaining({
        status: 'failed',
        last_error: 'Target thread is unavailable',
        next_wake_at: null,
      })
    );
    expect(addAwaiterWakeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        awaiter_id: 'awaiter_1',
        outcome: 'error',
        error: 'Target thread is unavailable',
      })
    );
    expect(chatServiceMock.send).not.toHaveBeenCalled();
  });

  it('rejects overlapping wakes while the same awaiter is already in flight', async () => {
    getAwaiterMock.mockReturnValue(baseAwaiter());
    chatServiceMock.getThread.mockReturnValue({ id: 'thread_1' });

    const deferred = createDeferred<{ success: true; text: string; runId: string }>();
    chatServiceMock.send.mockReturnValue(deferred.promise);

    const firstRun = runAwaiterWake('awaiter_1');
    const secondRun = await runAwaiterWake('awaiter_1');

    expect(secondRun).toEqual({ success: false, error: 'Awaiter already waking' });

    deferred.resolve({ success: true, text: 'done', runId: 'run_wake_overlap' });
    await firstRun;
  });

  it('retries a persisted waking awaiter so restart does not strand it forever', async () => {
    getAwaiterMock.mockReturnValue(baseAwaiter({ status: 'waking' }));
    chatServiceMock.getThread.mockReturnValue({ id: 'thread_1' });
    chatServiceMock.send.mockResolvedValue({
      success: true,
      text: 'Recovered wake complete.',
      runId: 'run_wake_recovered',
    });

    const result = await runAwaiterWake('awaiter_1');

    expect(result).toEqual({ success: true, runId: 'run_wake_recovered' });
    expect(chatServiceMock.send).toHaveBeenCalledTimes(1);
  });

  it('does not clobber a mid-flight reschedule when the awaiter was re-armed', async () => {
    const sendMock = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } } as unknown as BrowserWindow,
    ]);

    getAwaiterMock
      .mockReturnValueOnce(baseAwaiter())
      .mockReturnValueOnce(
        baseAwaiter({
          status: 'armed',
          next_wake_at: '2026-04-24T01:00:00.000Z',
          updated_at: '2026-04-23T06:05:00.000Z',
        })
      )
      .mockReturnValue(
        baseAwaiter({
          status: 'armed',
          next_wake_at: '2026-04-24T01:00:00.000Z',
          updated_at: '2026-04-23T06:05:00.000Z',
        })
      );
    chatServiceMock.getThread.mockReturnValue({ id: 'thread_1' });
    chatServiceMock.send.mockResolvedValue({
      success: true,
      text: 'Wake complete.',
      runId: 'run_wake_rearmed',
    });
    updateAwaiterIfStatusMock.mockReturnValue({ changes: 0 } as { changes: number });

    const result = await runAwaiterWake('awaiter_1');

    expect(result).toEqual({ success: true, runId: 'run_wake_rearmed' });
    expect(updateAwaiterMock).toHaveBeenCalledTimes(1);
    expect(updateAwaiterMock).toHaveBeenCalledWith('awaiter_1', {
      status: 'waking',
      last_error: null,
    });
    expect(updateAwaiterIfStatusMock).toHaveBeenCalledWith('awaiter_1', 'waking', {
      status: 'completed',
      last_wake_at: expect.any(String),
      last_error: null,
      next_wake_at: null,
    });
    expect(addAwaiterWakeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        awaiter_id: 'awaiter_1',
        outcome: 'success',
        run_id: 'run_wake_rearmed',
      })
    );
    expect(chatServiceMock.createMessage).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      'awaiters:push',
      expect.objectContaining({
        type: 'awaiter-result',
        status: 'completed',
      })
    );
  });

  it('suppresses post-wake side effects when the awaiter is deleted while the wake is in flight', async () => {
    const sendMock = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } } as unknown as BrowserWindow,
    ]);

    getAwaiterMock
      .mockReturnValueOnce(baseAwaiter())
      .mockReturnValueOnce(null);
    chatServiceMock.getThread.mockReturnValue({ id: 'thread_1' });
    chatServiceMock.send.mockResolvedValue({
      success: true,
      text: 'Wake complete.',
      runId: 'run_wake_deleted',
    });

    const result = await runAwaiterWake('awaiter_1');

    expect(result).toEqual({
      success: false,
      error: 'Awaiter no longer exists',
      runId: 'run_wake_deleted',
    });
    expect(addAwaiterWakeEventMock).not.toHaveBeenCalled();
    expect(chatServiceMock.createMessage).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('scheduler runs due awaiters on tick and does not repeat once the due set clears', async () => {
    vi.useFakeTimers();

    listDueAwaitersMock.mockReturnValueOnce([baseAwaiter()]).mockReturnValue([]);
    getAwaiterMock.mockReturnValue(baseAwaiter());
    chatServiceMock.getThread.mockReturnValue({ id: 'thread_1' });
    chatServiceMock.send.mockResolvedValue({
      success: true,
      text: 'Wake complete.',
      runId: 'run_wake_sched_1',
    });

    startAwaiterScheduler();
    await vi.runAllTicks();
    await Promise.resolve();

    expect(chatServiceMock.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(listDueAwaitersMock).toHaveBeenCalledTimes(2);
    expect(chatServiceMock.send).toHaveBeenCalledTimes(1);
  });
});
