// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { useChatThreadTodoPlan } from '../../../src/renderer/composables/useChatThreadTodoPlan';

vi.mock('../../../src/renderer/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    span: vi.fn(),
  })),
}));

const mountHarness = async (options?: {
  initialThreadId?: string | null;
  plans?: Array<unknown>;
}) => {
  const threadId = ref<string | null>(options?.initialThreadId ?? 'thread_1');
  const getTodoPlan = vi.fn(async () => options?.plans?.shift() ?? null);
  const state = {
    activeTodoPlan: ref<unknown>(null),
    todoPlan: ref<unknown>(null),
    handleChatChunk: (_chunk: unknown) => undefined,
  };

  const Harness = defineComponent({
    name: 'UseChatThreadTodoPlanHarness',
    setup() {
      const result = useChatThreadTodoPlan({
        electronAPI: {
          chat: {
            threads: {
              getTodoPlan,
            },
          },
        } as never,
        threadId,
      });

      state.activeTodoPlan = result.activeTodoPlan;
      state.todoPlan = result.todoPlan;
      state.handleChatChunk = result.handleChatChunk;
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  await flushPromises();

  return {
    wrapper,
    threadId,
    getTodoPlan,
    state,
  };
};

describe('useChatThreadTodoPlan', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('loads the current thread plan and exposes it when work remains', async () => {
    const activePlan = {
      thread_id: 'thread_1',
      items: [
        { id: '1', text: 'Inspect current state', status: 'completed' },
        { id: '2', text: 'Build composer card', status: 'in_progress' },
      ],
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:01:00.000Z',
    };

    const { getTodoPlan, state } = await mountHarness({
      plans: [activePlan],
    });

    expect(getTodoPlan).toHaveBeenCalledWith('thread_1');
    expect(state.todoPlan.value).toEqual(activePlan);
    expect(state.activeTodoPlan.value).toEqual(activePlan);
  });

  it('keeps completed plans loaded but hides them from the composer surface', async () => {
    const completedPlan = {
      thread_id: 'thread_1',
      items: [{ id: '1', text: 'All done', status: 'completed' }],
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:01:00.000Z',
    };

    const { state } = await mountHarness({
      plans: [completedPlan],
    });

    expect(state.todoPlan.value).toEqual(completedPlan);
    expect(state.activeTodoPlan.value).toBeNull();
  });

  it('refreshes the thread plan after tool completion chunks and when the active thread changes', async () => {
    const initialPlan = {
      thread_id: 'thread_1',
      items: [{ id: '1', text: 'Implement todo card', status: 'in_progress' }],
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:01:00.000Z',
    };
    const refreshedPlan = {
      thread_id: 'thread_1',
      items: [{ id: '1', text: 'Implement todo card', status: 'completed' }],
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:02:00.000Z',
    };
    const nextThreadPlan = {
      thread_id: 'thread_2',
      items: [{ id: '1', text: 'Investigate next task', status: 'pending' }],
      created_at: '2026-03-30T00:03:00.000Z',
      updated_at: '2026-03-30T00:03:00.000Z',
    };

    const { threadId, getTodoPlan, state } = await mountHarness({
      plans: [initialPlan, refreshedPlan, nextThreadPlan],
    });

    state.handleChatChunk({ type: 'tool-output-available' });
    await flushPromises();

    expect(getTodoPlan).toHaveBeenNthCalledWith(2, 'thread_1');
    expect(state.todoPlan.value).toEqual(refreshedPlan);
    expect(state.activeTodoPlan.value).toBeNull();

    threadId.value = 'thread_2';
    await flushPromises();

    expect(getTodoPlan).toHaveBeenNthCalledWith(3, 'thread_2');
    expect(state.todoPlan.value).toEqual(nextThreadPlan);
    expect(state.activeTodoPlan.value).toEqual(nextThreadPlan);
  });
});
