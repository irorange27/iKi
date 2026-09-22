import { describe, expect, it } from 'vitest';

import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import type { ActiveStreamState } from '@iki/backend/thread_session/types';

const makeStreamState = (): ActiveStreamState => ({
  cancelled: false,
  stoppedByUser: false,
  abortController: new AbortController(),
});

describe('createThreadStreamCoordinator', () => {
  it('rejects concurrent runs only on the same thread and releases exactly once', () => {
    const coordinator = createThreadStreamCoordinator();
    const release = coordinator.tryAcquireThreadRun('a')!;
    expect(coordinator.tryAcquireThreadRun('a')).toBeNull();
    const releaseOther = coordinator.tryAcquireThreadRun('b')!;
    release();
    const releaseNew = coordinator.tryAcquireThreadRun('a')!;
    release();
    expect(coordinator.tryAcquireThreadRun('a')).toBeNull();
    releaseNew();
    releaseOther();
  });

  it('does not keep stale thread membership after a sender switches threads', () => {
    const coordinator = createThreadStreamCoordinator();
    const old = makeStreamState();
    coordinator.trackThreadStream('a', 7);
    coordinator.registerStream(7, old);
    coordinator.supersedeActiveStream(7);
    const current = makeStreamState();
    coordinator.trackThreadStream('b', 7);
    coordinator.registerStream(7, current);
    coordinator.unregisterStream(7, old);
    coordinator.cancelThreadStreams('a');
    expect(current.cancelled).toBe(false);
    expect(coordinator.steerStream(7, 'b', 'hello')).toEqual({ success: true });
  });

  it('steer requires the thread to belong to the sender', () => {
    const coordinator = createThreadStreamCoordinator();

    const streamState = makeStreamState();
    coordinator.registerStream(42, streamState);
    coordinator.trackThreadStream('thread-a', 42);

    // Another connection's thread must not be steerable from sender 42.
    expect(coordinator.steerStream(42, 'thread-b', 'go left')).toEqual({
      success: false,
      error: 'No active stream for thread',
    });

    const result = coordinator.steerStream(42, 'thread-a', 'go left');
    expect(result).toEqual({ success: true });
    expect(streamState.steered).toBe(true);
  });

  it('steer without a thread targets the sender active stream', () => {
    const coordinator = createThreadStreamCoordinator();

    const streamState = makeStreamState();
    coordinator.registerStream(42, streamState);

    expect(coordinator.steerStream(42, undefined, 'go left')).toEqual({ success: true });
    expect(coordinator.takeSteerMessages(42)).toEqual(['go left']);
    expect(coordinator.takeSteerMessages(42)).toEqual([]);
    expect(streamState.steered).toBe(true);
  });

  it('stop cancels the stream and closes its steer queue', () => {
    const coordinator = createThreadStreamCoordinator();

    const streamState = makeStreamState();
    coordinator.registerStream(42, streamState);

    expect(coordinator.stopStream(42)).toEqual({ success: true });
    expect(streamState.cancelled).toBe(true);
    expect(streamState.stoppedByUser).toBe(true);
    // Queue closed: further steer attempts fail instead of queueing.
    expect(coordinator.steerStream(42, undefined, 'late')).toEqual({
      success: false,
      error: 'No active autonomous stream to steer',
    });
    coordinator.unregisterStream(42, streamState);
    expect(coordinator.peekStream(42)).toBeUndefined();
  });

  it('cancelThreadStreams aborts every other sender on the thread', () => {
    const coordinator = createThreadStreamCoordinator();

    const first = makeStreamState();
    const second = makeStreamState();
    coordinator.registerStream(1, first);
    coordinator.registerStream(2, second);
    coordinator.trackThreadStream('thread-a', 1);
    coordinator.trackThreadStream('thread-a', 2);

    coordinator.cancelThreadStreams('thread-a', 2);

    expect(first.cancelled).toBe(true);
    expect(second.cancelled).toBe(false);
  });

  it('unregisterStream keeps a newer stream registration for the same sender', () => {
    const coordinator = createThreadStreamCoordinator();

    const stale = makeStreamState();
    const current = makeStreamState();
    coordinator.registerStream(42, stale);
    coordinator.registerStream(42, current);

    coordinator.unregisterStream(42, stale);
    expect(coordinator.peekStream(42)).toBe(current);
    expect(coordinator.steerStream(42, undefined, "still active")).toEqual({ success: true });
    expect(coordinator.takeSteerMessages(42)).toEqual(["still active"]);

    coordinator.unregisterStream(42, current);
    expect(coordinator.peekStream(42)).toBeUndefined();
  });

  it('abortStreamByRunId aborts only the first live stream running that run', () => {
    const coordinator = createThreadStreamCoordinator();

    const first = makeStreamState();
    first.runId = 'run-1';
    const second = makeStreamState();
    second.runId = 'run-2';
    coordinator.registerStream(1, first);
    coordinator.registerStream(2, second);

    expect(coordinator.abortStreamByRunId('run-1')).toBe(true);
    expect(first.cancelled).toBe(true);
    expect(first.stoppedByUser).toBe(false);
    expect(second.cancelled).toBe(false);

    // Already-cancelled streams are skipped, unknown runs find nothing.
    expect(coordinator.abortStreamByRunId('run-1')).toBe(false);
    expect(coordinator.abortStreamByRunId('run-404')).toBe(false);
  });

  it('run cancellation reaches streams attached outside the coordinator session', () => {
    const coordinator = createThreadStreamCoordinator();

    // Approval resume attaches its stream without a session — run
    // cancellation must still find it.
    const resumed = makeStreamState();
    resumed.runId = 'run-9';
    coordinator.attachStream(7, resumed);

    expect(coordinator.abortStreamByRunId('run-9')).toBe(true);
    expect(resumed.cancelled).toBe(true);
  });

  it('a stream attached without a session cannot be steered but can be stopped', () => {
    const coordinator = createThreadStreamCoordinator();

    const resumed = makeStreamState();
    coordinator.attachStream(7, resumed);

    expect(coordinator.steerStream(7, undefined, 'x')).toEqual({
      success: false,
      error: 'No active autonomous stream to steer',
    });
    expect(coordinator.stopStream(7)).toEqual({ success: true });
    expect(resumed.cancelled).toBe(true);
  });

  it('detachStream only removes the stream it attached', () => {
    const coordinator = createThreadStreamCoordinator();

    const resumed = makeStreamState();
    coordinator.attachStream(7, resumed);

    // A superseding stream took the sender's slot: the stale detach is a no-op.
    const replacement = makeStreamState();
    coordinator.attachStream(7, replacement);

    coordinator.detachStream(7, resumed);
    expect(coordinator.peekStream(7)).toBe(replacement);

    coordinator.detachStream(7, replacement);
    expect(coordinator.peekStream(7)).toBeUndefined();
  });
});

describe('createThreadStreamCoordinator cross-process lease', () => {
  it('declines admission when another process holds the thread lease', () => {
    const heldThreads = new Set(['thread_remote']);
    const coordinator = createThreadStreamCoordinator({
      crossProcessThreadRun: threadId => {
        if (heldThreads.has(threadId)) return null;
        heldThreads.add(threadId);
        return () => {
          heldThreads.delete(threadId);
        };
      },
    });

    expect(coordinator.tryAcquireThreadRun('thread_remote')).toBeNull();

    const release = coordinator.tryAcquireThreadRun('thread_local');
    expect(release).not.toBeNull();
    // In-process fast path still guards while the cross lease is held locally.
    expect(coordinator.tryAcquireThreadRun('thread_local')).toBeNull();
    release!();
    expect(coordinator.tryAcquireThreadRun('thread_local')).not.toBeNull();
  });

  it('releases the cross-process lease together with the in-process one', () => {
    const released: string[] = [];
    const coordinator = createThreadStreamCoordinator({
      crossProcessThreadRun: threadId => () => {
        released.push(threadId);
      },
    });

    const release = coordinator.tryAcquireThreadRun('thread_xproc');
    release!();
    release!(); // idempotent: cross lease released exactly once
    expect(released).toEqual(['thread_xproc']);
  });
});

describe('createThreadStreamCoordinator lease-loss abort', () => {
  it('aborts the thread active stream when the cross-process lease is reported lost', () => {
    let notifyLeaseLost: (() => void) | undefined;
    const coordinator = createThreadStreamCoordinator({
      crossProcessThreadRun: (_threadId, options) => {
        notifyLeaseLost = options.onLeaseLost;
        return () => undefined;
      },
    });

    const release = coordinator.tryAcquireThreadRun('thread_lost');
    expect(release).not.toBeNull();

    const stream = makeStreamState();
    coordinator.trackThreadStream('thread_lost', 11);
    coordinator.registerStream(11, stream);
    expect(stream.cancelled).toBe(false);

    notifyLeaseLost!();
    expect(stream.cancelled).toBe(true);
    expect(stream.abortController.signal.aborted).toBe(true);

    release!();
  });
});
