import { createRateLimiter } from '@iki/backend/rate_limiter';
import type { ActiveStreamState } from './types';

const THREAD_RATE_LIMIT_WINDOW_MS = 10_000;
const THREAD_RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * Owns stream coordination state: which senders stream which thread,
 * per-thread rate limiting, per-stream steer queues, and the
 * stop/steer/supersede operations over the shared activeStreams map.
 *
 * Keyed by sender (transport connection id) today; ADR 004 phase 2
 * re-keys this on threadId once sessions own their streams.
 */
export const createThreadStreamCoordinator = (deps: {
  activeStreams: Map<number, ActiveStreamState>;
}) => {
  const threadStreams = new Map<string, Set<number>>();
  const steerQueues = new Map<number, string[]>();
  const threadRunLimiter = createRateLimiter({
    windowMs: THREAD_RATE_LIMIT_WINDOW_MS,
    maxRequests: THREAD_RATE_LIMIT_MAX_REQUESTS,
  });

  const checkThreadRunRate = (threadId: string): { allowed: boolean; retryAfterMs?: number } => {
    if (!threadId) return { allowed: true };
    return threadRunLimiter.check(threadId);
  };

  const cancelThreadStreams = (threadId: string, exceptSenderId?: number) => {
    const senderIds = threadStreams.get(threadId);
    if (!senderIds || senderIds.size === 0) return;
    for (const senderId of senderIds) {
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
    const senderIds = threadStreams.get(threadId);
    if (senderIds) {
      senderIds.add(senderId);
    } else {
      threadStreams.set(threadId, new Set([senderId]));
    }
  };

  const untrackThreadStream = (threadId: string, senderId: number) => {
    const senderIds = threadStreams.get(threadId);
    if (!senderIds) return;
    senderIds.delete(senderId);
    if (senderIds.size === 0) {
      threadStreams.delete(threadId);
    }
  };

  const registerStream = (senderId: number, streamState: ActiveStreamState) => {
    deps.activeStreams.set(senderId, streamState);
    steerQueues.set(senderId, []);
  };

  const unregisterStream = (senderId: number, streamState: ActiveStreamState) => {
    steerQueues.delete(senderId);
    if (deps.activeStreams.get(senderId) === streamState) {
      deps.activeStreams.delete(senderId);
    }
  };

  /** Drain pending steer messages for a stream. */
  const takeSteerMessages = (senderId: number): string[] => {
    const queue = steerQueues.get(senderId);
    if (!queue) return [];
    return queue.splice(0, queue.length);
  };

  const stopStream = (senderId: number) => {
    const streamState = deps.activeStreams.get(senderId);
    if (!streamState) {
      return { success: false, error: 'No active stream' };
    }

    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    steerQueues.delete(senderId);
    return { success: true };
  };

  const steerStream = (
    senderId: number,
    threadId: string | undefined,
    message: string,
  ): { success: boolean; error?: string } => {
    if (threadId && !threadStreams.get(threadId)?.has(senderId)) {
      return { success: false, error: 'No active stream for thread' };
    }
    const steerQueue = steerQueues.get(senderId);
    if (!steerQueue) {
      return { success: false, error: 'No active autonomous stream to steer' };
    }
    steerQueue.push(message);
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
