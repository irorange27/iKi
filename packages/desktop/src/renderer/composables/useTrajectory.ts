import { getErrorMessage } from '@iki/backend/utils/errors';
import type { AgentRun, AgentRunTrace } from '@iki/backend/types/agent_run';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';

const POLL_INTERVAL_MS = 2_000;
const ACTIVE_STATUSES = new Set<AgentRun['status']>(['queued', 'running', 'blocked']);

type TraceCacheEntry = {
  updatedAt: string;
  status: AgentRun['status'];
  trace: AgentRunTrace;
};

type RefreshCycle = {
  generation: number;
  threadId: string;
  running: boolean;
  queued: boolean;
  promise: Promise<void> | null;
};

export const useTrajectory = (
  threadId: Ref<string | null>,
  electronAPI: Pick<ElectronApi, 'chat'>
) => {
  const traces = shallowRef<AgentRunTrace[]>([]);
  const loading = ref(false);
  const error = ref('');

  // This cache belongs to this mounted trajectory view. Completed traces are
  // immutable for a given run signature; active traces must be reread.
  const traceCache = new Map<string, TraceCacheEntry>();
  let generation = 0;
  let mounted = false;
  let currentCycle: RefreshCycle | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let removeRunStatusListener: (() => void) | null = null;
  let sawActiveRun = false;

  const clearPollTimer = () => {
    if (pollTimer === null) return;
    clearTimeout(pollTimer);
    pollTimer = null;
  };

  const makeCycle = (id: string): RefreshCycle => ({
    generation,
    threadId: id,
    running: false,
    queued: false,
    promise: null,
  });

  const isCurrent = (cycle: RefreshCycle) =>
    mounted && currentCycle === cycle && cycle.generation === generation;

  const schedulePoll = () => {
    if (!mounted || currentCycle === null || pollTimer !== null) return;
    // With the status bridge, run events restart refreshes on their own —
    // keep the timer only while a run is in flight (or on older builds
    // without the bridge, where polling is the only update channel).
    if (removeRunStatusListener !== null && !sawActiveRun) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void refreshCycle(currentCycle);
    }, POLL_INTERVAL_MS);
  };

  const loadCycle = async (cycle: RefreshCycle) => {
    if (!isCurrent(cycle)) return;

    try {
      const runs = (await electronAPI.chat.runs.list(cycle.threadId)) ?? [];
      if (!isCurrent(cycle)) return;
      sawActiveRun = runs.some(run => ACTIVE_STATUSES.has(run.status));

      const nextCache = new Map<string, TraceCacheEntry>();
      const loaded = await Promise.all(
        runs.map(async run => {
          const cached = traceCache.get(run.id);
          const isActive = ACTIVE_STATUSES.has(run.status);
          const canReuse =
            !isActive &&
            cached !== undefined &&
            cached.updatedAt === run.updatedAt &&
            cached.status === run.status;
          const trace =
            canReuse && cached !== undefined
              ? cached.trace
              : await electronAPI.chat.runs.getTrace(run.id);

          if (trace !== null) {
            nextCache.set(run.id, {
              updatedAt: run.updatedAt,
              status: run.status,
              trace,
            });
          }
          return trace;
        })
      );

      if (!isCurrent(cycle)) return;

      // Replacing the map also forgets runs removed from the thread list.
      traceCache.clear();
      for (const [id, entry] of nextCache) traceCache.set(id, entry);

      const nextTraces = loaded.filter((trace): trace is AgentRunTrace => trace !== null);
      const unchanged =
        traces.value.length === nextTraces.length &&
        traces.value.every((trace, index) => trace === nextTraces[index]);
      if (!unchanged) traces.value = nextTraces;
      error.value = '';
    } catch (loadError) {
      if (isCurrent(cycle)) error.value = getErrorMessage(loadError);
    }
  };

  const refreshCycle = (cycle: RefreshCycle | null): Promise<void> => {
    if (!mounted || cycle === null || !isCurrent(cycle)) return Promise.resolve();
    clearPollTimer();

    if (cycle.running) {
      // A status event during a refresh must cause a trailing pass. Multiple
      // events coalesce into one pass without losing the terminal update.
      cycle.queued = true;
      return cycle.promise ?? Promise.resolve();
    }

    cycle.running = true;
    cycle.queued = true;
    loading.value = true;

    const promise = (async () => {
      try {
        while (cycle.queued && isCurrent(cycle)) {
          cycle.queued = false;
          await loadCycle(cycle);
        }
      } finally {
        cycle.running = false;
        cycle.promise = null;
        if (isCurrent(cycle)) {
          loading.value = false;
          schedulePoll();
        }
      }
    })();
    cycle.promise = promise;
    return promise;
  };

  const refresh = () => refreshCycle(currentCycle);

  watch(
    threadId,
    nextThreadId => {
      generation += 1;
      clearPollTimer();
      traceCache.clear();
      traces.value = [];
      error.value = '';
      loading.value = false;
      sawActiveRun = false;
      currentCycle = nextThreadId ? makeCycle(nextThreadId) : null;

      if (mounted && currentCycle !== null) void refreshCycle(currentCycle);
    },
    { flush: 'sync' }
  );

  onMounted(() => {
    mounted = true;
    try {
      removeRunStatusListener = electronAPI.chat.onRunStatus(event => {
        const activeThreadId = threadId.value;
        const belongsToThread =
          activeThreadId !== null &&
          (event.threadId === activeThreadId ||
            (event.threadId == null && traces.value.some(trace => trace.run.id === event.runId)));
        if (!belongsToThread) return;
        void refreshCycle(currentCycle);
      });
    } catch {
      // Keep polling available in older builds without the status bridge.
      removeRunStatusListener = null;
    }

    if (threadId.value) {
      if (currentCycle === null || currentCycle.threadId !== threadId.value) {
        currentCycle = makeCycle(threadId.value);
      }
      void refreshCycle(currentCycle);
    }
  });

  onUnmounted(() => {
    mounted = false;
    generation += 1;
    currentCycle = null;
    clearPollTimer();
    removeRunStatusListener?.();
    removeRunStatusListener = null;
  });

  return { traces, loading, error, refresh };
};
