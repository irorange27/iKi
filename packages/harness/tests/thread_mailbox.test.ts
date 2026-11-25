import { describe, expect, it } from 'vitest';
import {
  createThreadMailbox,
  type ThreadMailboxChatPort,
  type ThreadMailboxTurnResult,
} from '../src/thread_session/mailbox';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('ThreadMailbox actor scheduler', () => {
  it('coalesces queued events while working, bounds concurrency, and assigns distinct negative senderIds', async () => {
    const running = new Set<string>();
    const senderIds: number[] = [];
    const seenBatches: Array<{ threadId: string; contents: string[] }> = [];
    const gates = new Map<string, ReturnType<typeof deferred<ThreadMailboxTurnResult>>>();
    let maxObservedConcurrency = 0;

    const chat: ThreadMailboxChatPort = {
      stream: async (target, options) => {
        const threadId = options.threadId!;
        senderIds.push(target.id);
        running.add(threadId);
        maxObservedConcurrency = Math.max(maxObservedConcurrency, running.size);
        const key = `${threadId}#${seenBatches.filter(b => b.threadId === threadId).length}`;
        const gate = gates.get(key);
        const result = gate ? await gate.promise : { success: true, text: 'ok' };
        running.delete(threadId);
        return result;
      },
      pushSteerByThread: () => false,
      cancelThreadStreams: () => undefined,
      isThreadRunning: threadId => running.has(threadId),
    };

    const mailbox = createThreadMailbox({
      chat,
      getMaxConcurrentActive: () => 2,
      defaultTurnBuilder: ({ threadId, events }) => {
        seenBatches.push({ threadId, contents: events.map(e => e.content) });
        return {
          threadId,
          providerType: 'openai',
          model: 'test',
          messages: [],
        };
      },
    });

    const g1 = deferred<ThreadMailboxTurnResult>();
    const g2 = deferred<ThreadMailboxTurnResult>();
    const g3 = deferred<ThreadMailboxTurnResult>();
    gates.set('t1#1', g1);
    gates.set('t2#1', g2);
    gates.set('t3#1', g3);

    mailbox.enqueue('t1', { source: 'board', content: 'm1' });
    mailbox.enqueue('t2', { source: 'board', content: 'm2' });
    mailbox.enqueue('t3', { source: 'board', content: 'm3' });

    // Wait one microtask for pump to invoke builders
    await Promise.resolve();
    expect(mailbox.getState('t1')).toBe('working');
    expect(mailbox.getState('t2')).toBe('working');
    // t3 is queued because maxConcurrentActive = 2
    expect(mailbox.getState('t3')).toBe('stopped');
    expect(maxObservedConcurrency).toBe(2);

    // Enqueue two more events on t1 while t1 is still working -> must coalesce into one next turn
    mailbox.enqueue('t1', { source: 'board', content: 'm1-b' });
    mailbox.enqueue('t1', { source: 'board', content: 'm1-c' });

    g1.resolve({ success: true, text: 'done1' });
    g2.resolve({ success: true, text: 'done2' });
    g3.resolve({ success: true, text: 'done3' });

    await mailbox.waitForIdle(['t1', 't2', 't3']);

    expect(maxObservedConcurrency).toBe(2);
    expect(senderIds.every(id => id < 0)).toBe(true);
    expect(new Set(senderIds).size).toBe(senderIds.length);
    expect(seenBatches.filter(b => b.threadId === 't1')).toEqual([
      { threadId: 't1', contents: ['m1'] },
      { threadId: 't1', contents: ['m1-b', 'm1-c'] },
    ]);
    expect(mailbox.getState('t1')).toBe('waiting');
    expect(mailbox.getState('t2')).toBe('waiting');
    expect(mailbox.getState('t3')).toBe('waiting');
  });

  it('supports steer delivery and permanent kill', async () => {
    const steered: Array<{ threadId: string; message: string }> = [];
    const cancelled: string[] = [];
    const gate = deferred<ThreadMailboxTurnResult>();

    const chat: ThreadMailboxChatPort = {
      stream: async () => gate.promise,
      pushSteerByThread: (threadId, message) => {
        steered.push({ threadId, message });
        return true;
      },
      cancelThreadStreams: threadId => {
        cancelled.push(threadId);
        gate.resolve({ success: true, stopped: true });
      },
      isThreadRunning: () => false,
    };

    const mailbox = createThreadMailbox({
      chat,
      defaultTurnBuilder: ({ threadId }) => ({
        threadId,
        providerType: 'openai',
        model: 'test',
        messages: [],
      }),
    });

    mailbox.enqueue('w1', { source: 'board', content: 'start' });
    await Promise.resolve();
    expect(mailbox.getState('w1')).toBe('working');

    const steerRes = mailbox.enqueue('w1', {
      source: 'user',
      content: 'change approach',
      priority: 'steer',
    });
    expect(steerRes).toEqual({ delivered: 'steered' });
    expect(steered).toEqual([{ threadId: 'w1', message: 'change approach' }]);

    await mailbox.kill('w1');
    expect(mailbox.getState('w1')).toBe('killed');
    expect(cancelled).toEqual(['w1']);
    expect(() => mailbox.enqueue('w1', { source: 'board', content: 'too late' })).toThrow(/killed/);
  });
});
