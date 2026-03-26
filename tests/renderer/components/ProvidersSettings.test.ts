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
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
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

    const apiKeyInput = wrapper.find('input[type="password"]');
    await apiKeyInput.setValue('test-key');
    await wrapper.find('.provider-switch input').setValue(true);
    await findButtonByText(wrapper, 'Save').trigger('click');
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

  it('surfaces OpenAI as a built-in provider with the official default base URL', async () => {
    const list = vi.fn(async () => []);
    const add = vi.fn(async () => ({ id: 'openai_176' }));

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
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
        },
      },
    });

    await flushPromises();

    const openaiRow = wrapper
      .findAll('.provider-list-item')
      .find(item => item.text().includes('OpenAI'));

    if (!openaiRow) {
      throw new Error('OpenAI provider row not found');
    }

    await openaiRow.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Inactive');
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(
      wrapper.find('input[placeholder="https://api.openai.com/v1"]').exists()
    ).toBe(true);

    const apiKeyInput = wrapper.find('input[type="password"]');
    await apiKeyInput.setValue('sk-test');
    await wrapper.find('.provider-switch input').setValue(true);
    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^openai_\d+$/),
        name: 'OpenAI',
        type: 'openai',
        api_key: 'sk-test',
        base_url: 'https://api.openai.com/v1',
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
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
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

  it('keeps OpenAI-compatible endpoints on the custom-provider path', async () => {
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
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, 'Add Custom Provider').trigger('click');
    await flushPromises();

    await wrapper.find('input[placeholder="e.g. My Local LLM"]').setValue('Proxy Gateway');
    await selectSettingsOption(wrapper, 'Type', 'OpenAI Compatible');
    await wrapper.find('input[placeholder="Enter API Key"]').setValue('proxy-key');
    await findButtonByText(wrapper, 'Save Provider').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Proxy Gateway',
        type: 'openai-compatible',
        api_key: 'proxy-key',
      })
    );
  });

  it('restores the persisted draft when cancel is pressed', async () => {
    const list = vi.fn(async () => [
      {
        id: 'openai_1',
        name: 'OpenAI',
        type: 'openai',
        api_key: 'saved-key',
        models: '["gpt-4.1"]',
        base_url: 'https://api.openai.com/v1',
        enabled: true,
        created_at: '2026-03-21T12:00:00.000Z',
        updated_at: '2026-03-21T12:00:00.000Z',
        available_models: '["gpt-4.1"]',
      },
    ]);

    setElectronApi({
      providers: {
        list,
        add: vi.fn(),
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
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
        },
      },
    });

    await flushPromises();

    const apiKeyInput = wrapper.find('input[type="password"]');
    expect((apiKeyInput.element as HTMLInputElement).value).toBe('saved-key');

    await apiKeyInput.setValue('changed-key');
    expect(findButtonByText(wrapper, 'Cancel').attributes('disabled')).toBeUndefined();
    expect(findButtonByText(wrapper, 'Save').attributes('disabled')).toBeUndefined();

    await findButtonByText(wrapper, 'Cancel').trigger('click');
    await flushPromises();

    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe(
      'saved-key'
    );
    expect(findButtonByText(wrapper, 'Cancel').attributes('disabled')).toBeDefined();
    expect(findButtonByText(wrapper, 'Save').attributes('disabled')).toBeDefined();
  });
});
