import { describe, expect, it } from 'vitest';

import { createThreadStreamCoordinator } from '@iki/backend/chat_service/thread_stream_coordinator';
import type { ActiveStreamState } from '@iki/backend/chat_service/types';

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
});
