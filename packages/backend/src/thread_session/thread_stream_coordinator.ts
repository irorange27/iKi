import { createRateLimiter } from '@iki/backend/rate_limiter';
import type { ActiveStreamState } from './types';

const THREAD_RATE_LIMIT_WINDOW_MS = 10_000;
const THREAD_RATE_LIMIT_MAX_REQUESTS = 5;

class ThreadSession {
  readonly threadId: string | null;
  readonly senderIds = new Set<number>();

  steerQueue: string[] | null = [];
  streamState: ActiveStreamState | null = null;

  constructor(threadId: string | null) {
    this.threadId = threadId;
  }
}

export type LiveRunExecution = {

  cancel: (reason: string) => void;

  setRunId: (runId: string | null) => void;

  dispose: () => void;
};

export const createThreadStreamCoordinator = (deps?: {

  crossProcessThreadRun?: (
    threadId: string,
    options: { onLeaseLost: () => void }
  ) => (() => void) | null;
}) => {
  const runningThreads = new Set<string>();

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

  const executionsByRunId = new Map<string, LiveRunExecution>();

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

  const registerChildRunAlias = (parentRunId: string, childRunId: string): (() => void) => {
    if (!parentRunId || !childRunId || parentRunId === childRunId) return () => undefined;
    childRunAliases.set(childRunId, parentRunId);
    return () => {
      if (childRunAliases.get(childRunId) === parentRunId) {
        childRunAliases.delete(childRunId);
      }
    };
  };

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
