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
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

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
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

    const streamState = makeStreamState();
    coordinator.registerStream(42, streamState);

    expect(coordinator.steerStream(42, undefined, 'go left')).toEqual({ success: true });
    expect(coordinator.takeSteerMessages(42)).toEqual(['go left']);
    expect(coordinator.takeSteerMessages(42)).toEqual([]);
    expect(streamState.steered).toBe(true);
  });

  it('stop cancels the stream and closes its steer queue', () => {
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

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
    expect(activeStreams.has(42)).toBe(false);
  });

  it('cancelThreadStreams aborts every other sender on the thread', () => {
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

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
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

    const stale = makeStreamState();
    const current = makeStreamState();
    coordinator.registerStream(42, stale);
    coordinator.registerStream(42, current);

    coordinator.unregisterStream(42, stale);
    expect(activeStreams.get(42)).toBe(current);

    coordinator.unregisterStream(42, current);
    expect(activeStreams.has(42)).toBe(false);
  });

  it('abortStreamByRunId aborts only the first live stream running that run', () => {
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

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

  it('run cancellation reaches streams registered outside the coordinator', () => {
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

    // Approval resume registers its stream directly into the shared map
    // without a coordinator session — run cancellation must still find it.
    const resumed = makeStreamState();
    resumed.runId = 'run-9';
    activeStreams.set(7, resumed);

    expect(coordinator.abortStreamByRunId('run-9')).toBe(true);
    expect(resumed.cancelled).toBe(true);
  });

  it('a stream registered without a session cannot be steered but can be stopped', () => {
    const activeStreams = new Map<number, ActiveStreamState>();
    const coordinator = createThreadStreamCoordinator({ activeStreams });

    const resumed = makeStreamState();
    activeStreams.set(7, resumed);

    expect(coordinator.steerStream(7, undefined, 'x')).toEqual({
      success: false,
      error: 'No active autonomous stream to steer',
    });
    expect(coordinator.stopStream(7)).toEqual({ success: true });
    expect(resumed.cancelled).toBe(true);
  });
});
