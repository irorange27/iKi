// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { useChatViewLifecycle } from '../../../packages/desktop/src/renderer/composables/useChatViewLifecycle';

const mountHarness = async (deps: Parameters<typeof useChatViewLifecycle>[0]) => {
  const Harness = defineComponent({
    name: 'UseChatViewLifecycleHarness',
    setup() {
      useChatViewLifecycle(deps);
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  await flushPromises();
  return wrapper;
};

describe('useChatViewLifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('initializes config once, refreshes chat metadata, and forwards chat/task/awaiter events', async () => {
    let taskPushHandler: ((payload: unknown) => void) | null = null;
    let awaiterPushHandler: ((payload: unknown) => void) | null = null;
    const removeTaskPushListener = vi.fn();
    const removeAwaiterPushListener = vi.fn();

    const deps = {
      configStore: {
        initialized: false,
        initialize: vi.fn(async () => undefined),
      },
      refreshThreads: vi.fn(async () => undefined),
      loadToolSources: vi.fn(async () => undefined),
      electronAPI: {
        tasks: {
          onPush: vi.fn((handler: (payload: unknown) => void) => {
            taskPushHandler = handler;
            return removeTaskPushListener;
          }),
        },
        awaiters: {
          onPush: vi.fn((handler: (payload: unknown) => void) => {
            awaiterPushHandler = handler;
            return removeAwaiterPushListener;
          }),
        },
      },
      handleTaskPush: vi.fn(async () => undefined),
      handleAwaiterPush: vi.fn(async () => undefined),
    };

    const wrapper = await mountHarness(deps as never);

    expect(deps.configStore.initialize).toHaveBeenCalledTimes(1);
    expect(deps.refreshThreads).toHaveBeenCalledTimes(1);
    expect(deps.loadToolSources).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.tasks.onPush).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.awaiters.onPush).toHaveBeenCalledTimes(1);

    taskPushHandler?.({ type: 'task-result', threadId: 'thread_1' });
    awaiterPushHandler?.({ type: 'awaiter-result', threadId: 'thread_1' });
    await flushPromises();

    expect(deps.handleTaskPush).toHaveBeenCalledWith({
      type: 'task-result',
      threadId: 'thread_1',
    });
    expect(deps.handleAwaiterPush).toHaveBeenCalledWith({
      type: 'awaiter-result',
      threadId: 'thread_1',
    });

    wrapper.unmount();

    expect(removeTaskPushListener).toHaveBeenCalledTimes(1);
    expect(removeAwaiterPushListener).toHaveBeenCalledTimes(1);
  });

  it('skips config initialization when the store is already initialized', async () => {
    const deps = {
      configStore: {
        initialized: true,
        initialize: vi.fn(async () => undefined),
      },
      refreshThreads: vi.fn(async () => undefined),
      loadToolSources: vi.fn(async () => undefined),
      electronAPI: {
        tasks: {
          onPush: vi.fn(() => () => undefined),
        },
        awaiters: {
          onPush: vi.fn(() => () => undefined),
        },
      },
      handleTaskPush: vi.fn(async () => undefined),
      handleAwaiterPush: vi.fn(async () => undefined),
    };

    const wrapper = await mountHarness(deps as never);

    expect(deps.configStore.initialize).not.toHaveBeenCalled();
    expect(deps.refreshThreads).toHaveBeenCalledTimes(1);
    expect(deps.loadToolSources).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('tolerates older builds that do not expose task push listeners', async () => {
    const deps = {
      configStore: {
        initialized: true,
        initialize: vi.fn(async () => undefined),
      },
      refreshThreads: vi.fn(async () => undefined),
      loadToolSources: vi.fn(async () => undefined),
      electronAPI: {
        tasks: {
          onPush: vi.fn(() => {
            throw new Error('tasks bridge unavailable');
          }),
        },
        awaiters: {
          onPush: vi.fn(() => {
            throw new Error('awaiters bridge unavailable');
          }),
        },
      },
      handleTaskPush: vi.fn(async () => undefined),
      handleAwaiterPush: vi.fn(async () => undefined),
    };

    const wrapper = await mountHarness(deps as never);

    expect(deps.refreshThreads).toHaveBeenCalledTimes(1);
    expect(deps.loadToolSources).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.tasks.onPush).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.awaiters.onPush).toHaveBeenCalledTimes(1);

    expect(() => wrapper.unmount()).not.toThrow();
  });
});
