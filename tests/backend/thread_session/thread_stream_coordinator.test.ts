import { describe, expect, it } from 'vitest';

import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import type { ActiveStreamState } from '@iki/backend/thread_session/types';

const makeStreamState = (): ActiveStreamState => ({
  cancelled: false,
  stoppedByUser: false,
  abortController: new AbortController(),
});

describe('createThreadStreamCoordinator', () => {
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
