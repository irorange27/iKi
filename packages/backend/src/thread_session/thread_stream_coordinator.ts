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
 * One live execution in this process, indexed by the run it executes.
 *
 * A cancel names a RUN. The sender-keyed stream registry is a delivery
 * surface (who receives chunks, who may steer) and must not be the only way
 * to reach an execution: the non-streaming send transport holds its own
 * AbortController and registers no stream at all, so keying cancellation off
 * stream membership left its execution unreachable while the run row was
 * rewritten to `cancelled`.
 *
 * The run id is mutable — a handoff chain swaps the executing run mid-turn —
 * so the record re-keys its own index entry instead of leaving a stale key.
 * `dispose` is idempotent and removes only the entry this record owns.
 */
export type LiveRunExecution = {
  /** Stop this execution. The reason rides the abort signal for the owner to classify. */
  cancel: (reason: string) => void;
  /** Point the record at the run it now executes; null = no run identity yet. */
  setRunId: (runId: string | null) => void;
  /** Stop indexing this execution; idempotent. */
  dispose: () => void;
};

/**
 * Owns all stream coordination state: the sender-keyed transport registry,
 * which senders stream which thread, per-thread rate limiting, per-thread
 * steer queues, the run-keyed live-execution index, and the
 * stop/steer/supersede/cancel operations over them.
 *
 * Approval resume attaches session-less streams via attachStream — they are
 * stoppable and run-cancellable but deliberately not steerable.
 *
 * Stop remains connection-domain by decision (ADR 004 phase 2): supersede
 * guarantees at most one active stream per connection, so the connection's
 * active stream is the current thread.
 */
export const createThreadStreamCoordinator = (deps?: {
  /**
   * Cross-process admission lease (SQLite-backed). Extends the per-thread
   * guard to turns running in other processes sharing the same database
   * (desktop + headless daemon). Returning null means "held elsewhere".
   * `onLeaseLost` fires when another process reclaims this holder's expired
   * lease, so the local run aborts instead of double-running the thread.
   */
  crossProcessThreadRun?: (
    threadId: string,
    options: { onLeaseLost: () => void }
  ) => (() => void) | null;
}) => {
  const runningThreads = new Set<string>();
  /**
   * Execution abort hooks keyed by thread, one slot per held lease. Every
   * entry that acquires a thread (stream, send, approval resume) registers
   * one, so a lease-loss barrier reaches executions that have no stream
   * membership at all.
   */
  const executionAbortHooks = new Map<string, Set<() => void>>();
  const abortThreadRunForLeaseLoss = (threadId: string) => {
    const session = sessionsByThread.get(threadId);
    const streamState = session?.streamState;
    if (streamState && !streamState.cancelled) {
      streamState.cancelled = true;
      streamState.abortController.abort('thread-lease-lost');
    }
    for (const abort of executionAbortHooks.get(threadId) ?? []) {
      abort();
    }
  };
  const tryAcquireThreadRun = (
    threadId?: string,
    options?: { onExecutionAbort?: () => void }
  ): (() => void) | null => {
    if (!threadId) return () => undefined;
    if (runningThreads.has(threadId)) return null;
    const releaseCrossProcess = deps?.crossProcessThreadRun?.(threadId, {
      onLeaseLost: () => abortThreadRunForLeaseLoss(threadId),
    });
    if (releaseCrossProcess === null) return null;
    runningThreads.add(threadId);
    if (options?.onExecutionAbort) {
      let hooks = executionAbortHooks.get(threadId);
      if (!hooks) {
        hooks = new Set();
        executionAbortHooks.set(threadId, hooks);
      }
      hooks.add(options.onExecutionAbort);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      runningThreads.delete(threadId);
      const hooks = executionAbortHooks.get(threadId);
      if (hooks) {
        if (options?.onExecutionAbort) hooks.delete(options.onExecutionAbort);
        if (hooks.size === 0) executionAbortHooks.delete(threadId);
      }
      releaseCrossProcess?.();
    };
  };
  const activeStreams = new Map<number, ActiveStreamState>();
  const sessionsByThread = new Map<string, ThreadSession>();
  const sessionBySender = new Map<number, ThreadSession>();
  /**
   * Live executions by the run they execute. The stream registry answers
   * "who is subscribed"; this answers "who is executing run X" — the only
   * question cancellation needs to answer. Stream membership stays a
   * delivery concern.
   */
  const executionsByRunId = new Map<string, LiveRunExecution>();
  /**
   * Delegated child runs that execute as part of a parent's tool call. The
   * child inherits the parent's abort signal, so the parent is the executing
   * unit; this map only makes the child's id address it.
   */
  const childRunAliases = new Map<string, string>();
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

  /**
   * Register a live execution under the run it owns. Every entry that can
   * execute a run (stream, send, approval resume) registers one, so a cancel
   * naming that run reaches the execution regardless of whether it has
   * stream membership. The entry disposes its record in its own cleanup.
   */
  const registerExecution = (execution: {
    cancel: (reason: string) => void;
    runId?: string | null;
  }): LiveRunExecution => {
    let runId = execution.runId ?? null;
    let disposed = false;
    const record: LiveRunExecution = {
      cancel: execution.cancel,
      setRunId: next => {
        if (disposed || next === runId) return;
        if (runId && executionsByRunId.get(runId) === record) {
          executionsByRunId.delete(runId);
        }
        runId = next;
        if (runId) executionsByRunId.set(runId, record);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (runId && executionsByRunId.get(runId) === record) {
          executionsByRunId.delete(runId);
        }
      },
    };
    if (runId) executionsByRunId.set(runId, record);
    return record;
  };

  /**
   * Cancel the execution owning `runId`. Returns false when no live execution
   * in this process owns the run — the caller must then treat the run as
   * "not executing here" and reconcile it against durable facts instead of
   * writing a terminal state it did not actually cause.
   *
   * A delegated child run has no execution of its own: the parent's tool call
   * is the executing unit and the child inherits the parent's abort signal,
   * so cancelling a child run addresses the parent's execution.
   */
  const cancelExecutionByRunId = (runId: string, reason: string): boolean => {
    const execution = executionsByRunId.get(runId);
    if (execution) {
      execution.cancel(reason);
      return true;
    }
    const parentRunId = childRunAliases.get(runId);
    if (!parentRunId) return false;
    const parent = executionsByRunId.get(parentRunId);
    if (!parent) return false;
    parent.cancel(reason);
    return true;
  };

  /**
   * Alias a delegated child run onto its parent's execution. The child
   * inherits the parent's abort signal, so the parent is the unit a cancel
   * stops; the alias only makes the child's id ADDRESS it. Disposed when the
   * parent's execution ends.
   */
  const registerChildRunAlias = (parentRunId: string, childRunId: string): (() => void) => {
    if (!parentRunId || !childRunId || parentRunId === childRunId) return () => undefined;
    childRunAliases.set(childRunId, parentRunId);
    return () => {
      if (childRunAliases.get(childRunId) === parentRunId) {
        childRunAliases.delete(childRunId);
      }
    };
  };

  /** Whether a live execution in this process currently owns the run. */
  const hasLiveExecutionForRun = (runId: string): boolean =>
    executionsByRunId.has(runId) || (() => {
      const parent = childRunAliases.get(runId);
      return Boolean(parent && executionsByRunId.has(parent));
    })();

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
    registerExecution,
    registerChildRunAlias,
    cancelExecutionByRunId,
    hasLiveExecutionForRun,
    peekStream,
    attachStream,
    detachStream,
  };
};

export type ThreadStreamCoordinator = ReturnType<typeof createThreadStreamCoordinator>;
