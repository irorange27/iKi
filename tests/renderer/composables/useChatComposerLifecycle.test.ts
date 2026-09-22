// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { useChatComposerLifecycle } from '../../../packages/desktop/src/renderer/composables/useChatComposerLifecycle';

const mountHarness = async (deps: Parameters<typeof useChatComposerLifecycle>[0]) => {
  const Harness = defineComponent({
    name: 'UseChatComposerLifecycleHarness',
    setup() {
      useChatComposerLifecycle(deps);
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  await flushPromises();
  return wrapper;
};

describe('useChatComposerLifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads provider/speech state on mount and reloads providers on update broadcasts', async () => {
    let onUpdatedHandler: (() => void) | null = null;
    const removeProviderListener = vi.fn();
    const deps = {
      electronAPI: {
        providers: {
          onUpdated: vi.fn((handler: () => void) => {
            onUpdatedHandler = handler;
            return removeProviderListener;
          }),
        },
      },
      activeModel: ref('gpt-4.1'),
      activeProviderId: ref<string | null>('openai'),
      loadAvailableProviders: vi.fn(async () => undefined),
      syncPreferredModel: vi.fn(),
      loadSpeechStatus: vi.fn(async () => undefined),
    };

    const wrapper = await mountHarness(deps as never);

    expect(deps.electronAPI.providers.onUpdated).toHaveBeenCalledTimes(1);
    expect(deps.loadAvailableProviders).toHaveBeenCalledWith('gpt-4.1', 'openai');
    expect(deps.loadSpeechStatus).toHaveBeenCalledTimes(1);

    onUpdatedHandler?.();
    await flushPromises();

    expect(deps.loadAvailableProviders).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    expect(removeProviderListener).toHaveBeenCalledTimes(1);
  });

  it('syncs the preferred model when the active model changes', async () => {
    const deps = {
      electronAPI: {
        providers: {
          onUpdated: vi.fn(() => vi.fn()),
        },
      },
      activeModel: ref('gpt-4.1'),
      activeProviderId: ref<string | null>('openai'),
      loadAvailableProviders: vi.fn(async () => undefined),
      syncPreferredModel: vi.fn(),
      loadSpeechStatus: vi.fn(async () => undefined),
    };

    const wrapper = await mountHarness(deps as never);
    deps.syncPreferredModel.mockClear();

    deps.activeModel.value = 'gpt-5.4';
    deps.activeProviderId.value = 'custom_gateway';
    await flushPromises();

    expect(deps.syncPreferredModel).toHaveBeenCalledWith('gpt-5.4', 'custom_gateway');

    wrapper.unmount();
  });
});
