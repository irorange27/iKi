import { createRateLimiter } from '@iki/backend/rate_limiter';
import type { ActiveStreamState } from './types';

const THREAD_RATE_LIMIT_WINDOW_MS = 10_000;
const THREAD_RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * Per-thread coordination record (ADR 004 / ADR 005 phase B): the thread is
 * the session key. Membership, the steer queue, and the active stream
 * reference live here — not in sender-keyed maps. Sender ids remain
 * transport-scoped handles.
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
 * Owns all stream coordination state: the sender-keyed transport registry,
 * which senders stream which thread, per-thread rate limiting, per-thread
 * steer queues, and the stop/steer/supersede/abort operations over them.
 *
 * Approval resume attaches session-less streams via attachStream — they are
 * stoppable and run-cancellable but deliberately not steerable.
 *
 * Stop remains connection-domain by decision (ADR 004 phase 2): supersede
 * guarantees at most one active stream per connection, so the connection's
 * active stream is the current thread.
 */
export const createThreadStreamCoordinator = () => {
  const runningThreads = new Set<string>();
  const tryAcquireThreadRun = (threadId?: string): (() => void) | null => {
    if (!threadId) return () => undefined;
    if (runningThreads.has(threadId)) return null;
    runningThreads.add(threadId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      runningThreads.delete(threadId);
    };
  };
  const activeStreams = new Map<number, ActiveStreamState>();
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
      const streamState = activeStreams.get(senderId);
      if (streamState && !streamState.cancelled) {
        streamState.cancelled = true;
        streamState.stoppedByUser = true;
        streamState.abortController.abort('superseded-by-same-thread');
      }
    }
  };

  const detachSenderSession = (senderId: number) => {
    const session = sessionBySender.get(senderId);
    if (!session) return;
    session.senderIds.delete(senderId);
    sessionBySender.delete(senderId);
    if (session.threadId && session.senderIds.size === 0) sessionsByThread.delete(session.threadId);
  };

  const supersedeActiveStream = (senderId: number) => {
    const streamState = activeStreams.get(senderId);
    if (streamState) {
      streamState.cancelled = true;
      streamState.abortController.abort('superseded-by-new-request');
    }
    detachSenderSession(senderId);
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
    activeStreams.set(senderId, streamState);
    const session = sessionBySender.get(senderId) ?? sessionForSender(senderId);
    session.senderIds.add(senderId);
    session.steerQueue = [];
    session.streamState = streamState;
  };

  const unregisterStream = (senderId: number, streamState: ActiveStreamState) => {
    if (activeStreams.get(senderId) !== streamState) return;
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
    if (activeStreams.get(senderId) === streamState) {
      activeStreams.delete(senderId);
    }
  };

  /** Drain pending steer messages for a stream. */
  const takeSteerMessages = (senderId: number): string[] => {
    const session = sessionBySender.get(senderId);
    if (!session?.steerQueue) return [];
    return session.steerQueue.splice(0, session.steerQueue.length);
  };

  const stopStream = (senderId: number) => {
    const streamState = activeStreams.get(senderId);
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

  /** Abort the active stream running `runId` (run cancellation; not user-stop). */
  const abortStreamByRunId = (runId: string): boolean => {
    for (const [, streamState] of activeStreams) {
      if (streamState.runId === runId && !streamState.cancelled) {
        streamState.cancelled = true;
        streamState.abortController.abort('run-cancelled');
        return true;
      }
    }
    return false;
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
    const streamState = activeStreams.get(senderId);
    if (streamState && !streamState.cancelled) {
      streamState.steered = true;
      streamState.abortController.abort('steer');
    }
    return { success: true };
  };

  // Session-less registry access for approval resume: the resumed stream is
  // stoppable and run-cancellable but gets no session, so it is not steerable
  // and does not participate in thread membership.

  const peekStream = (senderId: number): ActiveStreamState | undefined =>
    activeStreams.get(senderId);

  const attachStream = (senderId: number, streamState: ActiveStreamState): void => {
    detachSenderSession(senderId);
    activeStreams.set(senderId, streamState);
  };

  const detachStream = (senderId: number, streamState: ActiveStreamState): void => {
    if (activeStreams.get(senderId) === streamState) {
      activeStreams.delete(senderId);
    }
  };

  return {
    tryAcquireThreadRun,
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
    abortStreamByRunId,
    peekStream,
    attachStream,
    detachStream,
  };
};

export type ThreadStreamCoordinator = ReturnType<typeof createThreadStreamCoordinator>;
