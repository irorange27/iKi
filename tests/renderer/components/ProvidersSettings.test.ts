// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import ProvidersSettings from '../../../src/renderer/components/settings/ProvidersSettings.vue';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

describe('ProvidersSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('creates a built-in provider config from the settings form', async () => {
    const list = vi.fn(async () => []);
    const add = vi.fn(async () => ({ id: 'deepseek_176' }));

    setElectronApi({
      providers: {
        list,
        add,
        update: vi.fn(),
        delete: vi.fn(),
      },
      chat: {
        getModels: vi.fn(async () => []),
      },
    });

    const wrapper = mount(ProvidersSettings, {
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          Cog: true,
          RefreshCw: true,
          Save: true,
        },
      },
    });

    await flushPromises();

    const deepseekRow = wrapper
      .findAll('.provider-list-item')
      .find(item => item.text().includes('DeepSeek'));

    if (!deepseekRow) {
      throw new Error('DeepSeek provider row not found');
    }

    await deepseekRow.trigger('click');
    await flushPromises();
    await findButtonByText(wrapper, 'Configure Provider').trigger('click');
    await flushPromises();

    const apiKeyInput = wrapper.find('input[type="password"]');
    await apiKeyInput.setValue('test-key');
    await findButtonByText(wrapper, 'Save & Enable Provider').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^deepseek_\d+$/),
        name: 'DeepSeek',
        type: 'deepseek',
        api_key: 'test-key',
        base_url: 'https://api.deepseek.com/v1',
        models: '[]',
        available_models: '[]',
        enabled: true,
      })
    );
    expect(list).toHaveBeenCalledTimes(2);
  });
});
