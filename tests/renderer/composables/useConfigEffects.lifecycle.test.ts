// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';

import { createDefaultAppConfig } from '../../../src/shared/config/defaults';

const useConfigStoreMock = vi.hoisted(() => vi.fn());
const storeState = reactive({
  config: createDefaultAppConfig(),
});

vi.mock('../../../src/renderer/store/config', () => ({
  useConfigStore: useConfigStoreMock,
}));

const mountHarness = async () => {
  const { useConfigEffects } = await import('../../../src/renderer/composables/useConfigEffects');

  const Harness = defineComponent({
    name: 'UseConfigEffectsHarness',
    setup() {
      useConfigEffects();
      return () => null;
    },
  });

  return mount(Harness);
};

describe('useConfigEffects lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    useConfigStoreMock.mockImplementation(() => storeState);
    storeState.config = createDefaultAppConfig();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('registers media listeners, applies system-theme changes, and cleans listeners up on unmount', async () => {
    const setWindowShadow = vi.fn();
    const setProperty = vi.fn();
    const setAttribute = vi.fn();
    let changeHandler: ((event: MediaQueryListEvent) => void) | null = null;

    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_event: string, handler: (event: MediaQueryListEvent) => void) => {
        changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };

    vi.stubGlobal('window', {
      electronAPI: {
        setWindowShadow,
      },
      matchMedia: vi.fn(() => mediaQuery),
    });
    vi.spyOn(document.documentElement.style, 'setProperty').mockImplementation(setProperty);
    vi.spyOn(document.documentElement, 'setAttribute').mockImplementation(setAttribute);

    const wrapper = await mountHarness();

    expect(window.matchMedia).toHaveBeenCalled();
    expect(mediaQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(setWindowShadow).toHaveBeenCalledWith(true);

    mediaQuery.matches = true;
    changeHandler?.({ matches: true } as MediaQueryListEvent);

    expect(setWindowShadow).toHaveBeenLastCalledWith(false);
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'dark');

    wrapper.unmount();

    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('uses legacy addListener/removeListener media APIs when modern listeners are unavailable', async () => {
    const setWindowShadow = vi.fn();
    const addListener = vi.fn();
    const removeListener = vi.fn();

    vi.stubGlobal('window', {
      electronAPI: {
        setWindowShadow,
      },
      matchMedia: vi.fn(() => ({
        matches: false,
        addListener,
        removeListener,
      })),
    });
    vi.spyOn(document.documentElement.style, 'setProperty').mockImplementation(() => undefined);
    vi.spyOn(document.documentElement, 'setAttribute').mockImplementation(() => undefined);

    const wrapper = await mountHarness();

    expect(addListener).toHaveBeenCalledWith(expect.any(Function));

    wrapper.unmount();

    expect(removeListener).toHaveBeenCalledWith(expect.any(Function));
    expect(setWindowShadow).toHaveBeenCalledWith(true);
  });
});
