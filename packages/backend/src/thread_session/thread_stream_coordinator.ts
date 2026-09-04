import { createRateLimiter } from '@iki/backend/rate_limiter';
import type { ActiveStreamState } from './types';

const THREAD_RATE_LIMIT_WINDOW_MS = 10_000;
const THREAD_RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * Per-thread coordination record (ADR 004 / ADR 005 phase B): the thread is
 * the session key. Membership, the steer queue, and the active stream
 * reference live here — not in sender-keyed maps. Sender ids remain
 * transport-scoped handles; `deps.activeStreams` stays the sender-keyed
 * transport registry shared with approval resume and run cancellation.
 */
class ThreadSession {
  readonly threadId: string | null;
  readonly senderIds = new Set<number>();
  /** Null once the stream is stopped/unregistered — steer targets a live stream. */
  steerQueue: string[] | null = [];
  streamState: ActiveStreamState | null = null;

  constructor(threadId: string | null) {
    this.threadId = threadId;
  }
}

/**
 * Owns stream coordination state: which senders stream which thread,
 * per-thread rate limiting, per-thread steer queues, and the
 * stop/steer/supersede operations over the shared activeStreams map.
 *
 * Stop remains connection-domain by decision (ADR 004 phase 2): supersede
 * guarantees at most one active stream per connection, so the connection's
 * active stream is the current thread.
 */
export const createThreadStreamCoordinator = (deps: {
  activeStreams: Map<number, ActiveStreamState>;
}) => {
  const sessionsByThread = new Map<string, ThreadSession>();
  const sessionBySender = new Map<number, ThreadSession>();
  const threadRunLimiter = createRateLimiter({
    windowMs: THREAD_RATE_LIMIT_WINDOW_MS,
    maxRequests: THREAD_RATE_LIMIT_MAX_REQUESTS,
  });

  const sessionForThread = (threadId: string): ThreadSession => {
    let session = sessionsByThread.get(threadId);
    if (!session) {
      session = new ThreadSession(threadId);
      sessionsByThread.set(threadId, session);
    }
    return session;
  };

  /** Thread-less streams (no options.threadId) get a sender-scoped session. */
  const sessionForSender = (senderId: number): ThreadSession => {
    let session = sessionBySender.get(senderId);
    if (!session) {
      session = new ThreadSession(null);
      sessionBySender.set(senderId, session);
    }
    return session;
  };

  const checkThreadRunRate = (threadId: string): { allowed: boolean; retryAfterMs?: number } => {
    if (!threadId) return { allowed: true };
    return threadRunLimiter.check(threadId);
  };

  const cancelThreadStreams = (threadId: string, exceptSenderId?: number) => {
    const session = sessionsByThread.get(threadId);
    if (!session || session.senderIds.size === 0) return;
    for (const senderId of session.senderIds) {
      if (senderId === exceptSenderId) continue;
      const streamState = deps.activeStreams.get(senderId);
      if (streamState && !streamState.cancelled) {
        streamState.cancelled = true;
        streamState.stoppedByUser = true;
        streamState.abortController.abort('superseded-by-same-thread');
      }
    }
  };

  const supersedeActiveStream = (senderId: number) => {
    const streamState = deps.activeStreams.get(senderId);
    if (streamState) {
      streamState.cancelled = true;
      streamState.abortController.abort('superseded-by-new-request');
    }
  };

  const trackThreadStream = (threadId: string, senderId: number) => {
    const session = sessionForThread(threadId);
    session.senderIds.add(senderId);
    sessionBySender.set(senderId, session);
  };

  const untrackThreadStream = (threadId: string, senderId: number) => {
    const session = sessionsByThread.get(threadId);
    if (!session || !session.senderIds.delete(senderId)) return;
    if (sessionBySender.get(senderId) === session) {
      sessionBySender.delete(senderId);
    }
    if (session.senderIds.size === 0) {
      sessionsByThread.delete(threadId);
    }
  };

  const registerStream = (senderId: number, streamState: ActiveStreamState) => {
    deps.activeStreams.set(senderId, streamState);
    const session = sessionBySender.get(senderId) ?? sessionForSender(senderId);
    session.senderIds.add(senderId);
    session.steerQueue = [];
    session.streamState = streamState;
  };

  const unregisterStream = (senderId: number, streamState: ActiveStreamState) => {
    const session = sessionBySender.get(senderId);
    if (session) {
      if (session.streamState === streamState) {
        session.streamState = null;
      }
      session.steerQueue = null;
      if (session.threadId === null) {
        session.senderIds.delete(senderId);
        sessionBySender.delete(senderId);
      }
    }
    if (deps.activeStreams.get(senderId) === streamState) {
      deps.activeStreams.delete(senderId);
    }
  };

  /** Drain pending steer messages for a stream. */
  const takeSteerMessages = (senderId: number): string[] => {
    const session = sessionBySender.get(senderId);
    if (!session?.steerQueue) return [];
    return session.steerQueue.splice(0, session.steerQueue.length);
  };

  const stopStream = (senderId: number) => {
    const streamState = deps.activeStreams.get(senderId);
    if (!streamState) {
      return { success: false, error: 'No active stream' };
    }

    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    const session = sessionBySender.get(senderId);
    if (session) {
      session.steerQueue = null;
    }
    return { success: true };
  };

  const steerStream = (
    senderId: number,
    threadId: string | undefined,
    message: string,
  ): { success: boolean; error?: string } => {
    if (threadId && !sessionsByThread.get(threadId)?.senderIds.has(senderId)) {
      return { success: false, error: 'No active stream for thread' };
    }
    const queue = sessionBySender.get(senderId)?.steerQueue;
    if (!queue) {
      return { success: false, error: 'No active autonomous stream to steer' };
    }
    queue.push(message);
    const streamState = deps.activeStreams.get(senderId);
    if (streamState && !streamState.cancelled) {
      streamState.steered = true;
      streamState.abortController.abort('steer');
    }
    return { success: true };
  };

  return {
    checkThreadRunRate,
    cancelThreadStreams,
    supersedeActiveStream,
    trackThreadStream,
    untrackThreadStream,
    registerStream,
    unregisterStream,
    takeSteerMessages,
    stopStream,
    steerStream,
  };
};

export type ThreadStreamCoordinator = ReturnType<typeof createThreadStreamCoordinator>;
