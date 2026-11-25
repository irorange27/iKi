import { randomUUID } from 'node:crypto';
import { createLogger } from '@iki/core/logger';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import type { ChatStreamTarget } from './types';

const logger = createLogger({ module: 'thread_mailbox' });

export type ActorState = 'working' | 'waiting' | 'stopped' | 'killed';

export type ThreadMailboxEvent = {
  id?: string;
  source: string;
  content: string;
  priority?: 'normal' | 'steer';
  metadata?: Record<string, unknown>;
};

export type ThreadMailboxTurnResult = {
  success: boolean;
  text?: string;
  error?: string;
  stopped?: boolean;
  runId?: string;
};

export type ThreadMailboxTurnBuilder = (params: {
  threadId: string;
  events: ReadonlyArray<ThreadMailboxEvent>;
}) => Promise<ChatTurnOptions | null> | ChatTurnOptions | null;

export type ThreadMailboxStreamEvent = {
  threadId: string;
  channel: string;
  payload: unknown;
};

export type ThreadMailboxStateChange = {
  threadId: string;
  previous: ActorState;
  current: ActorState;
  reason?: string;
};

export type ThreadMailboxTurnSettled = {
  threadId: string;
  events: ReadonlyArray<ThreadMailboxEvent>;
  result: ThreadMailboxTurnResult;
};

export type ThreadMailboxChatPort = {
  stream: (target: ChatStreamTarget, options: ChatTurnOptions) => Promise<ThreadMailboxTurnResult>;
  pushSteerByThread: (threadId: string, message: string) => boolean;
  cancelThreadStreams: (threadId: string, exceptSenderId?: number) => void;
  isThreadRunning: (threadId: string) => boolean;
};

type ActorSlot = {
  threadId: string;
  state: ActorState;
  queue: ThreadMailboxEvent[];
  turnBuilder?: ThreadMailboxTurnBuilder;
  activePromise?: Promise<void>;
  activeSenderId?: number;
};

export const createThreadMailbox = (deps: {
  chat: ThreadMailboxChatPort;
  getMaxConcurrentActive?: () => number;
  defaultTurnBuilder?: ThreadMailboxTurnBuilder;
}) => {
  const slots = new Map<string, ActorSlot>();
  const readyOrder: string[] = [];
  const stateListeners = new Set<(change: ThreadMailboxStateChange) => void>();
  const streamListeners = new Set<(event: ThreadMailboxStreamEvent) => void>();
  const settledListeners = new Set<(settled: ThreadMailboxTurnSettled) => void>();
  const idleWaiters = new Set<() => void>();

  // Negative senderIds guarantee headless actor turns never collide with
  // interactive CLI/Desktop senders (which use positive ids >= 1).
  let nextHeadlessSenderId = -1;
  let activeCount = 0;

  const getMaxConcurrent = (): number => {
    const configured = deps.getMaxConcurrentActive?.();
    return typeof configured === 'number' && Number.isFinite(configured) && configured >= 1
      ? Math.trunc(configured)
      : 4;
  };

  const ensureSlot = (threadId: string, initialState: ActorState = 'stopped'): ActorSlot => {
    let slot = slots.get(threadId);
    if (!slot) {
      slot = { threadId, state: initialState, queue: [] };
      slots.set(threadId, slot);
    }
    return slot;
  };

  const notifyIdleWaiters = () => {
    for (const check of [...idleWaiters]) {
      check();
    }
  };

  const transition = (slot: ActorSlot, next: ActorState, reason?: string) => {
    if (slot.state === next) return;
    const previous = slot.state;
    slot.state = next;
    for (const listener of stateListeners) {
      try {
        listener({ threadId: slot.threadId, previous, current: next, ...(reason ? { reason } : {}) });
      } catch (error) {
        logger.warn('thread mailbox state listener failed', { threadId: slot.threadId, error });
      }
    }
    notifyIdleWaiters();
  };

  const markReady = (threadId: string) => {
    if (!readyOrder.includes(threadId)) {
      readyOrder.push(threadId);
    }
  };

  const runSlotTurn = (slot: ActorSlot) => {
    const batch = slot.queue.splice(0, slot.queue.length);
    if (batch.length === 0) {
      notifyIdleWaiters();
      return;
    }

    activeCount += 1;
    transition(slot, 'working', 'mailbox-wake');
    const senderId = nextHeadlessSenderId--;
    slot.activeSenderId = senderId;

    const target: ChatStreamTarget = {
      id: senderId,
      send: (channel, payload) => {
        for (const listener of streamListeners) {
          try {
            listener({ threadId: slot.threadId, channel, payload });
          } catch (error) {
            logger.warn('thread mailbox stream listener failed', {
              threadId: slot.threadId,
              channel,
              error,
            });
          }
        }
      },
    };

    const run = (async () => {
      let result: ThreadMailboxTurnResult = { success: true };
      try {
        const builder = slot.turnBuilder ?? deps.defaultTurnBuilder;
        if (!builder) {
          throw new Error(`No turn builder registered for thread "${slot.threadId}".`);
        }
        const turnOptions = await builder({ threadId: slot.threadId, events: batch });
        if (turnOptions && slot.state !== 'killed') {
          result = await deps.chat.stream(target, turnOptions);
        }
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        activeCount = Math.max(0, activeCount - 1);
        slot.activeSenderId = undefined;
        slot.activePromise = undefined;
        if (slot.state !== 'killed') {
          transition(slot, 'waiting', result.success ? 'turn-complete' : 'turn-error');
        }
        for (const listener of settledListeners) {
          try {
            listener({ threadId: slot.threadId, events: batch, result });
          } catch (error) {
            logger.warn('thread mailbox settled listener failed', {
              threadId: slot.threadId,
              error,
            });
          }
        }
        if (slot.state !== 'killed' && slot.queue.length > 0) {
          markReady(slot.threadId);
        }
        pump();
        notifyIdleWaiters();
      }
    })();

    slot.activePromise = run;
  };

  const pump = () => {
    const limit = getMaxConcurrent();
    while (activeCount < limit && readyOrder.length > 0) {
      const threadId = readyOrder.shift()!;
      const slot = slots.get(threadId);
      if (!slot) continue;
      if (slot.state === 'killed' || slot.state === 'working') continue;
      if (slot.queue.length === 0) continue;
      if (deps.chat.isThreadRunning(threadId)) {
        // Another caller (e.g. foreground CLI) currently holds the thread lease;
        // re-try on next tick once it yields rather than failing the mailbox wake.
        setTimeout(() => {
          if (slot.state !== 'killed' && slot.queue.length > 0) {
            markReady(threadId);
            pump();
          }
        }, 50).unref();
        continue;
      }
      runSlotTurn(slot);
    }
  };

  const registerThread = (
    threadId: string,
    options?: {
      initialState?: ActorState;
      turnBuilder?: ThreadMailboxTurnBuilder;
    }
  ): void => {
    const slot = ensureSlot(threadId, options?.initialState ?? 'waiting');
    if (options?.turnBuilder) {
      slot.turnBuilder = options.turnBuilder;
    }
    if (options?.initialState && slot.state === 'stopped' && options.initialState !== 'stopped') {
      transition(slot, options.initialState, 'registered');
    }
  };

  const enqueue = (
    threadId: string,
    event: ThreadMailboxEvent
  ): { delivered: 'steered' | 'queued' } => {
    const slot = ensureSlot(threadId, 'stopped');
    if (slot.state === 'killed') {
      throw new Error(`Thread "${threadId}" has been killed and cannot accept new events.`);
    }

    const normalized: ThreadMailboxEvent = {
      ...event,
      id: event.id ?? `evt_${randomUUID().slice(0, 8)}`,
    };

    if (normalized.priority === 'steer') {
      if (deps.chat.pushSteerByThread(threadId, normalized.content)) {
        return { delivered: 'steered' };
      }
      slot.queue.unshift(normalized);
      markReady(threadId);
      pump();
      return { delivered: 'queued' };
    }

    slot.queue.push(normalized);
    if (slot.state !== 'working') {
      markReady(threadId);
      pump();
    }
    return { delivered: 'queued' };
  };

  const kill = async (threadId: string): Promise<void> => {
    const slot = ensureSlot(threadId, 'stopped');
    slot.queue.length = 0;
    transition(slot, 'killed', 'killed');
    deps.chat.cancelThreadStreams(threadId);
    if (slot.activePromise) {
      await slot.activePromise;
    }
  };

  const getState = (threadId: string): ActorState => {
    const slot = slots.get(threadId);
    if (slot) return slot.state;
    return deps.chat.isThreadRunning(threadId) ? 'working' : 'stopped';
  };

  const getPendingCount = (threadId: string): number => slots.get(threadId)?.queue.length ?? 0;

  const isSetIdle = (threadIds?: readonly string[]): boolean => {
    const targets = threadIds
      ? threadIds.map(id => slots.get(id)).filter((s): s is ActorSlot => Boolean(s))
      : [...slots.values()];
    return targets.every(
      slot =>
        slot.state === 'killed' ||
        (slot.state !== 'working' && slot.queue.length === 0 && !deps.chat.isThreadRunning(slot.threadId))
    );
  };

  const waitForIdle = (threadIds?: readonly string[], timeoutMs = 30_000): Promise<void> => {
    if (isSetIdle(threadIds)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        idleWaiters.delete(check);
        reject(new Error(`Timed out waiting for mailbox threads to become idle (${timeoutMs}ms).`));
      }, timeoutMs);
      const check = () => {
        if (!isSetIdle(threadIds)) return;
        clearTimeout(timer);
        idleWaiters.delete(check);
        resolve();
      };
      idleWaiters.add(check);
      check();
    });
  };

  const onStateChange = (listener: (change: ThreadMailboxStateChange) => void): (() => void) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  };

  const onStreamEvent = (listener: (event: ThreadMailboxStreamEvent) => void): (() => void) => {
    streamListeners.add(listener);
    return () => streamListeners.delete(listener);
  };

  const onTurnSettled = (listener: (settled: ThreadMailboxTurnSettled) => void): (() => void) => {
    settledListeners.add(listener);
    return () => settledListeners.delete(listener);
  };

  return {
    registerThread,
    enqueue,
    kill,
    getState,
    getPendingCount,
    waitForIdle,
    onStateChange,
    onStreamEvent,
    onTurnSettled,
  };
};

export type ThreadMailbox = ReturnType<typeof createThreadMailbox>;
