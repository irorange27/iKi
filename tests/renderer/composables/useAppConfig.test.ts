// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';

import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import { useAppConfig } from '../../../src/renderer/composables/useAppConfig';

type AppConfigApi = ReturnType<typeof useAppConfig>;

const mountHarness = async () => {
  const Harness = defineComponent({
    name: 'UseAppConfigHarness',
    setup() {
      return {
        appConfig: useAppConfig(),
      };
    },
    render() {
      return h('div');
    },
  });

  const wrapper = mount(Harness, {
    global: {
      plugins: [createPinia()],
    },
  });

  await flushPromises();
  return wrapper as typeof wrapper & {
    vm: typeof wrapper.vm & { appConfig: AppConfigApi };
  };
};

describe('useAppConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('initializes from electron config and stays subscribed to config updates', async () => {
    const baseConfig = createDefaultAppConfig();
    baseConfig.general.theme = 'dark';

    let onUpdatedHandler: ((config: ReturnType<typeof createDefaultAppConfig>) => void) | null = null;
    const get = vi.fn(async () => baseConfig);
    const set = vi.fn(async () => undefined);
    const onUpdated = vi.fn((callback: (config: ReturnType<typeof createDefaultAppConfig>) => void) => {
      onUpdatedHandler = callback;
    });

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        config: {
          get,
          set,
          onUpdated,
        },
      },
    });

    const wrapper = await mountHarness();

    expect(get).toHaveBeenCalledTimes(1);
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.appConfig.theme.value).toBe('dark');

    const pushedConfig = createDefaultAppConfig();
    pushedConfig.general.theme = 'light';
    onUpdatedHandler?.(pushedConfig);
    await flushPromises();

    expect(wrapper.vm.appConfig.theme.value).toBe('light');
    expect(set).not.toHaveBeenCalled();
  });

  it('debounces multiple updates into one save with the merged config state', async () => {
    const get = vi.fn(async () => createDefaultAppConfig());
    const set = vi.fn(async () => undefined);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        config: {
          get,
          set,
          onUpdated: vi.fn(),
        },
      },
    });

    const wrapper = await mountHarness();

    wrapper.vm.appConfig.updateUi('fontSize', 18);
    wrapper.vm.appConfig.updateNetwork('proxy.host', '127.0.0.1');
    wrapper.vm.appConfig.updateNetwork('timeout', 8000);

    expect(set).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        ui: expect.objectContaining({
          fontSize: 18,
        }),
        network: expect.objectContaining({
          timeout: 8000,
          proxy: expect.objectContaining({
            host: '127.0.0.1',
          }),
        }),
      })
    );
  });

  it('flushes a pending auto-save immediately when saveNow is called', async () => {
    const get = vi.fn(async () => createDefaultAppConfig());
    const set = vi.fn(async () => undefined);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        config: {
          get,
          set,
          onUpdated: vi.fn(),
        },
      },
    });

    const wrapper = await mountHarness();

    wrapper.vm.appConfig.updateGeneral('theme', 'dark');
    await wrapper.vm.appConfig.saveNow();
    await flushPromises();

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        general: expect.objectContaining({
          theme: 'dark',
        }),
      })
    );

    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(set).toHaveBeenCalledTimes(1);
  });
});
