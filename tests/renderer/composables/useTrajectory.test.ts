// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref, type Ref } from 'vue';
import type { AgentRun, AgentRunTrace } from '@iki/backend/types/agent_run';
import type { ElectronApi, RunStatusEvent } from '@iki/backend/types/electron_api';

import { useTrajectory } from '../../../packages/desktop/src/renderer/composables/useTrajectory';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeRun = (
  id: string,
  status: AgentRun['status'] = 'completed',
  updatedAt = `${id}-updated`
): AgentRun => ({
  id,
  kind: 'chat-turn',
  status,
  threadId: 'thread_a',
  parentRunId: null,
  rootRunId: id,
  providerType: 'test',
  providerId: null,
  model: 'test-model',
  systemPrompt: '',
  enabledTools: [],
  availableSkillIds: [],
  input: {},
  working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
  output: null,
  error: null,
  createdAt: `${id}-created`,
  updatedAt,
});

const makeTrace = (run: AgentRun): AgentRunTrace => ({
  run,
  steps: [],
  latestCheckpoint: null,
  children: [],
});

const wrappers: Array<{ unmount: () => void }> = [];

const mountHarness = (
  threadId: Ref<string | null>,
  runs: Pick<ElectronApi, 'chat'>['chat']['runs'],
  onRunStatus?: (callback: (event: RunStatusEvent) => void) => () => void
) => {
  const state = { value: null as ReturnType<typeof useTrajectory> | null };
  const Harness = defineComponent({
    name: 'UseTrajectoryHarness',
    setup() {
      state.value = useTrajectory(threadId, { chat: { runs, onRunStatus } } as never);
      return () => h('div');
    },
  });
  const wrapper = mount(Harness);
  wrappers.push(wrapper);
  return { wrapper, state };
};

describe('useTrajectory', () => {
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('loads on mount and polls even while the thread has no runs', async () => {
    vi.useFakeTimers();
    const discoveredRun = makeRun('run_new');
    const discoveredTrace = makeTrace(discoveredRun);
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([discoveredRun]);
    const getTrace = vi.fn().mockResolvedValue(discoveredTrace);
    const { state } = mountHarness(ref<string | null>('thread_a'), {
      list,
      getTrace,
    } as never);

    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);
    expect(state.value?.traces.value).toEqual([]);

    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);
    expect(state.value?.traces.value).toEqual([discoveredTrace]);
  });

  it('does not let a slow old-thread load overwrite the fast new-thread load', async () => {
    const threadAList = deferred<AgentRun[]>();
    const threadBList = deferred<AgentRun[]>();
    const threadBTrace = deferred<AgentRunTrace | null>();
    const runA = makeRun('run_a');
    const runB = makeRun('run_b');
    const traceA = makeTrace(runA);
    const traceB = makeTrace(runB);
    const list = vi.fn((id: string) =>
      id === 'thread_a' ? threadAList.promise : threadBList.promise
    );
    const getTrace = vi.fn((id: string) =>
      id === 'run_a' ? Promise.resolve(traceA) : threadBTrace.promise
    );
    const threadId = ref<string | null>('thread_a');
    const { state } = mountHarness(threadId, { list, getTrace } as never);

    expect(list).toHaveBeenCalledWith('thread_a');
    expect(state.value?.loading.value).toBe(true);
    threadId.value = 'thread_b';
    expect(state.value?.traces.value).toEqual([]);
    expect(state.value?.error.value).toBe('');
    expect(list).toHaveBeenCalledWith('thread_b');

    threadBList.resolve([runB]);
    await flushPromises();
    expect(state.value?.loading.value).toBe(true);

    threadAList.resolve([runA]);
    await flushPromises();
    expect(state.value?.traces.value).toEqual([]);
    expect(state.value?.loading.value).toBe(true);

    threadBTrace.resolve(traceB);
    await flushPromises();
    expect(state.value?.traces.value).toEqual([traceB]);
    expect(state.value?.loading.value).toBe(false);
  });

  it('keeps the same array for immutable completed traces and removes vanished runs', async () => {
    vi.useFakeTimers();
    const run = makeRun('run_done');
    const trace = makeTrace(run);
    const list = vi
      .fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([]);
    const getTrace = vi.fn().mockResolvedValue(trace);
    const { state } = mountHarness(ref<string | null>('thread_a'), {
      list,
      getTrace,
    } as never);

    await flushPromises();
    const firstArray = state.value?.traces.value;
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(getTrace).toHaveBeenCalledTimes(1);
    expect(state.value?.traces.value).toBe(firstArray);

    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(state.value?.traces.value).toEqual([]);
  });

  it('rereads active traces, skips null traces, and preserves successful data on failure', async () => {
    vi.useFakeTimers();
    const completed = makeRun('run_complete');
    const updated = makeRun('run_complete', 'completed', 'changed');
    const active = makeRun('run_active', 'running');
    const nullRun = makeRun('run_null', 'completed');
    const stableTrace = makeTrace(completed);
    const activeTrace1 = makeTrace(active);
    const activeTrace2 = makeTrace(active);
    const list = vi
      .fn()
      .mockResolvedValueOnce([completed, active])
      .mockResolvedValueOnce([completed, active])
      .mockResolvedValueOnce([updated])
      .mockResolvedValueOnce([nullRun]);
    const getTrace = vi
      .fn()
      .mockResolvedValueOnce(stableTrace)
      .mockResolvedValueOnce(activeTrace1)
      .mockResolvedValueOnce(activeTrace2)
      .mockRejectedValueOnce(new Error('trace unavailable'))
      .mockResolvedValueOnce(null);
    const { state } = mountHarness(ref<string | null>('thread_a'), {
      list,
      getTrace,
    } as never);

    await flushPromises();
    expect(state.value?.traces.value).toEqual([stableTrace, activeTrace1]);

    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(getTrace).toHaveBeenCalledTimes(3);
    expect(state.value?.traces.value).toEqual([stableTrace, activeTrace2]);

    await state.value?.refresh();
    expect(state.value?.error.value).toBe('trace unavailable');
    expect(state.value?.traces.value).toEqual([stableTrace, activeTrace2]);

    await state.value?.refresh();
    expect(state.value?.error.value).toBe('');
    expect(state.value?.traces.value).toEqual([]);
  });

  it('queues a terminal status refresh and unregisters without post-unmount writes', async () => {
    vi.useFakeTimers();
    const firstList = deferred<AgentRun[]>();
    const terminalTrace = deferred<AgentRunTrace | null>();
    const terminalRun = makeRun('run_terminal');
    let onStatus: ((event: RunStatusEvent) => void) | undefined;
    const removeListener = vi.fn();
    const list = vi
      .fn()
      .mockReturnValueOnce(firstList.promise)
      .mockResolvedValueOnce([terminalRun]);
    const trace = makeTrace(terminalRun);
    const getTrace = vi.fn().mockReturnValue(terminalTrace.promise);
    const runs = {
      list,
      getTrace,
      onRunStatus: vi.fn((callback: (event: RunStatusEvent) => void) => {
        onStatus = callback;
        return removeListener;
      }),
    };
    const { wrapper, state } = mountHarness(
      ref<string | null>('thread_a'),
      runs as never,
      runs.onRunStatus
    );
    const originalLoading = state.value?.loading;

    onStatus?.({
      runId: 'run_terminal',
      status: 'completed',
      threadId: 'thread_a',
      timestamp: 'now',
    });
    firstList.resolve([]);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);
    expect(getTrace).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    const snapshot = state.value?.traces.value;
    const loadingSnapshot = state.value?.loading.value;
    expect(removeListener).toHaveBeenCalledTimes(1);
    terminalTrace.resolve(trace);
    await vi.advanceTimersByTimeAsync(4_000);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);
    expect(state.value?.traces.value).toBe(snapshot);
    expect(state.value?.loading.value).toBe(loadingSnapshot);
    expect(originalLoading?.value).toBe(true);
  });

  it('stops timer polling once settled when the status bridge is available and restarts on events', async () => {
    vi.useFakeTimers();
    const run = makeRun('run_done');
    const trace = makeTrace(run);
    let onStatus: ((event: RunStatusEvent) => void) | undefined;
    const list = vi.fn().mockResolvedValue([run]);
    const getTrace = vi.fn().mockResolvedValue(trace);
    const runs = {
      list,
      getTrace,
      onRunStatus: vi.fn((callback: (event: RunStatusEvent) => void) => {
        onStatus = callback;
        return () => undefined;
      }),
    };
    const { state } = mountHarness(
      ref<string | null>('thread_a'),
      runs as never,
      runs.onRunStatus
    );

    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6_000);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);

    onStatus?.({ runId: 'run_done', status: 'completed', threadId: 'thread_a', timestamp: 'now' });
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(6_000);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);
    expect(state.value?.traces.value).toEqual([trace]);
  });

  it('keeps timer polling while a run is active even with the status bridge', async () => {
    vi.useFakeTimers();
    const run = makeRun('run_active', 'running');
    const runs = {
      list: vi.fn().mockResolvedValue([run]),
      getTrace: vi.fn().mockResolvedValue(makeTrace(run)),
      onRunStatus: vi.fn(() => () => undefined),
    };
    const { state } = mountHarness(
      ref<string | null>('thread_a'),
      runs as never,
      runs.onRunStatus
    );

    await flushPromises();
    expect(runs.list).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(runs.list).toHaveBeenCalledTimes(2);
    expect(state.value?.traces.value).toEqual([makeTrace(run)]);
  });
});
