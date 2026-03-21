// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { useChatViewLifecycle } from '../../../src/renderer/composables/useChatViewLifecycle';

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

  it('initializes config once, refreshes chat metadata, and forwards chat/task events', async () => {
    let uiChunkHandler: ((chunk: unknown) => void) | null = null;
    let taskPushHandler: ((payload: unknown) => void) | null = null;

    const deps = {
      configStore: {
        initialized: false,
        initialize: vi.fn(async () => undefined),
      },
      refreshThreads: vi.fn(async () => undefined),
      loadToolSources: vi.fn(async () => undefined),
      electronAPI: {
        chat: {
          removeAllListeners: vi.fn(),
          onUiChunk: vi.fn((handler: (chunk: unknown) => void) => {
            uiChunkHandler = handler;
          }),
        },
        tasks: {
          removeAllListeners: vi.fn(),
          onPush: vi.fn((handler: (payload: unknown) => void) => {
            taskPushHandler = handler;
          }),
        },
      },
      streamController: {
        handleUiChunk: vi.fn(async () => undefined),
      },
      handleTaskPush: vi.fn(async () => undefined),
    };

    const wrapper = await mountHarness(deps as never);

    expect(deps.configStore.initialize).toHaveBeenCalledTimes(1);
    expect(deps.refreshThreads).toHaveBeenCalledTimes(1);
    expect(deps.loadToolSources).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.chat.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.chat.onUiChunk).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.tasks.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.tasks.onPush).toHaveBeenCalledTimes(1);

    uiChunkHandler?.({ type: 'text-delta', delta: 'hello' });
    taskPushHandler?.({ type: 'task-result', threadId: 'thread_1' });
    await flushPromises();

    expect(deps.streamController.handleUiChunk).toHaveBeenCalledWith({
      type: 'text-delta',
      delta: 'hello',
    });
    expect(deps.handleTaskPush).toHaveBeenCalledWith({
      type: 'task-result',
      threadId: 'thread_1',
    });

    wrapper.unmount();

    expect(deps.electronAPI.chat.removeAllListeners).toHaveBeenCalledTimes(2);
    expect(deps.electronAPI.tasks.removeAllListeners).toHaveBeenCalledTimes(2);
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
        chat: {
          removeAllListeners: vi.fn(),
          onUiChunk: vi.fn(),
        },
        tasks: {
          removeAllListeners: vi.fn(),
          onPush: vi.fn(),
        },
      },
      streamController: {
        handleUiChunk: vi.fn(async () => undefined),
      },
      handleTaskPush: vi.fn(async () => undefined),
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
        chat: {
          removeAllListeners: vi.fn(),
          onUiChunk: vi.fn(),
        },
        tasks: {
          removeAllListeners: vi.fn(() => {
            throw new Error('tasks bridge unavailable');
          }),
          onPush: vi.fn(),
        },
      },
      streamController: {
        handleUiChunk: vi.fn(async () => undefined),
      },
      handleTaskPush: vi.fn(async () => undefined),
    };

    const wrapper = await mountHarness(deps as never);

    expect(deps.refreshThreads).toHaveBeenCalledTimes(1);
    expect(deps.loadToolSources).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.chat.onUiChunk).toHaveBeenCalledTimes(1);
    expect(deps.electronAPI.tasks.onPush).not.toHaveBeenCalled();

    expect(() => wrapper.unmount()).not.toThrow();
  });
});
