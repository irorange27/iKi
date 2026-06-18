// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import SettingsNetworkSection from '../../../packages/desktop/src/renderer/components/settings/SettingsNetworkSection.vue';
import { useConfigStore } from '../../../packages/desktop/src/renderer/store/config';
import { createDefaultAppConfig } from '@iki/core/config/defaults';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findLabelByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('label')
    .find(label => label.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Label not found: ${text}`);
  }

  return match;
};

const selectSettingsOption = async (wrapper: VueWrapper, labelText: string, optionText: string) => {
  const label = findLabelByText(wrapper, labelText);
  await label.find('.settings-select-trigger').trigger('click');
  await flushPromises();

  const option = label
    .findAll('.settings-select-option')
    .find(candidate => candidate.text().replace(/\s+/g, ' ').includes(optionText));

  if (!option) {
    throw new Error(`Option not found for "${labelText}": ${optionText}`);
  }

  await option.trigger('click');
  await flushPromises();
};

const mountSettingsNetworkSection = async (options?: {
  setupStore?: (store: ReturnType<typeof useConfigStore>) => void;
  testNetworkResult?: Record<string, unknown>;
}) => {
  const pinia = createPinia();
  setActivePinia(pinia);

  const testNetwork = vi.fn(async (network: ReturnType<typeof createDefaultAppConfig>['network']) => {
    const searchEngineUrl =
      network.webSearch.preferredEngine === 'duckduckgo'
        ? 'https://html.duckduckgo.com/html/?q=ping'
        : network.webSearch.preferredEngine === 'bing'
          ? 'https://www.bing.com/search?format=rss&q=ping'
          : 'https://www.google.com/generate_204';

    return {
      success: true,
      testedAt: '2026-04-07T00:00:00.000Z',
      effectiveProxy: 'socks5://127.0.0.1:1080',
      error: null,
      results: [
        {
          key: 'internet',
          url: 'https://example.com/',
          success: true,
          statusCode: 200,
          durationMs: 120,
          error: null,
          resolvedProxy: 'SOCKS5 127.0.0.1:1080',
        },
        {
          key: 'searchEngine',
          url: searchEngineUrl,
          success: true,
          statusCode: network.webSearch.preferredEngine === 'google' ? 204 : 200,
          durationMs: 180,
          error: null,
          resolvedProxy: 'SOCKS5 127.0.0.1:1080',
        },
      ],
      ...(options?.testNetworkResult ?? {}),
    };
  });

  setElectronApi({
    config: {
      testNetwork,
    },
  });

  const store = useConfigStore();
  store.config = createDefaultAppConfig();
  options?.setupStore?.(store);

  const wrapper = mount(SettingsNetworkSection, {
    props: {
      active: true,
    },
    global: {
      plugins: [pinia],
      stubs: {
        RefreshCw: true,
      },
    },
    attachTo: document.body,
  });

  await flushPromises();

  return { wrapper, store, testNetwork };
};

describe('SettingsNetworkSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
  });

  it('updates the preferred search engine, proxy settings, and runs a connectivity test with the current draft values', async () => {
    const { wrapper, store, testNetwork } = await mountSettingsNetworkSection({
      setupStore: configStore => {
        configStore.config.network.proxy.enable = true;
      },
    });

    await selectSettingsOption(wrapper, 'Preferred Search Engine', 'DuckDuckGo');
    await selectSettingsOption(wrapper, 'Type', 'SOCKS5');

    const hostInput = findLabelByText(wrapper, 'Host').find('input');
    await hostInput.setValue('127.0.0.1');

    const portInput = findLabelByText(wrapper, 'Port').find('input');
    await portInput.setValue('1080');

    const usernameInput = findLabelByText(wrapper, 'Username').find('input');
    await usernameInput.setValue('alice');

    const passwordInput = findLabelByText(wrapper, 'Password').find('input');
    await passwordInput.setValue('secret');

    await wrapper.find('.network-test-btn').trigger('click');
    await flushPromises();

    expect(store.config.network.proxy.type).toBe('socks5');
    expect(store.config.network.webSearch.preferredEngine).toBe('duckduckgo');
    expect(store.config.network.proxy.host).toBe('127.0.0.1');
    expect(store.config.network.proxy.port).toBe(1080);
    expect(store.config.network.proxy.username).toBe('alice');
    expect(store.config.network.proxy.password).toBe('secret');
    expect(testNetwork).toHaveBeenCalledWith({
      proxy: {
        enable: true,
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: 'alice',
        password: 'secret',
      },
      webSearch: {
        preferredEngine: 'duckduckgo',
      },
      timeout: 5000,
      retryAttempts: 3,
    });
    expect(wrapper.text()).toContain('DuckDuckGo reachability');
    expect(wrapper.text()).toContain('Network ready');
    expect(wrapper.emitted('config-change')?.length).toBeGreaterThan(0);
  });

  it('disables testing when the proxy configuration is incomplete', async () => {
    const { wrapper } = await mountSettingsNetworkSection({
      setupStore: configStore => {
        configStore.config.network.proxy.enable = true;
        configStore.config.network.proxy.type = 'socks5';
      },
    });

    const testButton = wrapper.find('.network-test-btn');

    expect(testButton.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Enter a proxy host before running the test.');
  });
});
