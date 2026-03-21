// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

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

  it('creates a custom provider with the selected shared dropdown type', async () => {
    const list = vi.fn(async () => []);
    const add = vi.fn(async () => ({ id: 'custom_176' }));

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
    await findButtonByText(wrapper, 'Add Custom Provider').trigger('click');
    await flushPromises();

    await wrapper.find('input[placeholder="e.g. My Local LLM"]').setValue('Anthropic Mirror');
    await selectSettingsOption(wrapper, 'Type', 'Anthropic');
    await wrapper.find('input[placeholder="Enter API Key"]').setValue('test-key');
    await findButtonByText(wrapper, 'Save Provider').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Anthropic Mirror',
        type: 'anthropic',
        api_key: 'test-key',
      })
    );
  });
});
