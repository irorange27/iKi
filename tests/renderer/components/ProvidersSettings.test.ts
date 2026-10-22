// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import ProvidersSettings from '../../../packages/desktop/src/renderer/components/settings/ProvidersSettings.vue';

const setElectronApi = (api: unknown) => {
  const defaultApi = {
    mcp: {
      list: vi.fn(async () => []),
    },
  };

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      ...defaultApi,
      ...(api as Record<string, unknown>),
      mcp: {
        ...defaultApi.mcp,
        ...((api as { mcp?: Record<string, unknown> }).mcp ?? {}),
      },
    },
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
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
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

  it('treats a toggled model as a change worth saving', async () => {
    const update = vi.fn(async () => ({}));
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
        available_models: '["gpt-4.1","o3"]',
      },
    ]);

    setElectronApi({
      providers: {
        list,
        add: vi.fn(),
        update,
        delete: vi.fn(),
      },
      chat: {
        getModels: vi.fn(async () => []),
      },
    });

    const wrapper = mount(ProvidersSettings, {
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
        },
      },
    });

    await flushPromises();
    await wrapper.find('.provider-models-toggle').trigger('click');
    await flushPromises();

    expect(findButtonByText(wrapper, 'Save').attributes('disabled')).toBeDefined();
    expect((wrapper.find('.model-toggle input').element as HTMLInputElement).checked).toBe(true);

    await wrapper.find('.model-toggle input').setValue(false);
    await flushPromises();

    expect(findButtonByText(wrapper, 'Cancel').attributes('disabled')).toBeUndefined();
    expect(findButtonByText(wrapper, 'Save').attributes('disabled')).toBeUndefined();

    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(1);
    const [, payload] = update.mock.calls[0];
    expect(JSON.parse(payload.models as string)).toEqual([]);
  });

  it('adds a manual model to the list before enabling it', async () => {
    const add = vi.fn(async () => ({ id: 'openai_176' }));

    setElectronApi({
      providers: {
        list: vi.fn(async () => []),
        add,
        update: vi.fn(),
        delete: vi.fn(),
      },
      chat: {
        getModels: vi.fn(async () => []),
      },
    });

    const wrapper = mount(ProvidersSettings, {
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
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
    await wrapper.find('.provider-models-toggle').trigger('click');
    await flushPromises();

    await wrapper.find('input[placeholder="Model ID"]').setValue('gpt-5.4/high');
    await wrapper
      .find('input[placeholder="Display Name (optional)"]')
      .setValue('GPT-5.4 High');
    await wrapper.find('.manual-add-btn').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('GPT-5.4 High');
    expect(wrapper.text()).toContain('0 enabled');

    const toggle = wrapper.find('.model-toggle input');
    expect((toggle.element as HTMLInputElement).checked).toBe(false);

    await toggle.setValue(true);
    await flushPromises();

    expect(wrapper.text()).toContain('1 enabled');

    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledTimes(1);
    const [payload] = add.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^openai_\d+$/),
        name: 'OpenAI',
        type: 'openai',
        models: '["gpt-5.4/high"]',
        available_models: '["gpt-5.4/high"]',
      })
    );
    expect(JSON.parse(payload.model_options as string)).toEqual({
      'gpt-5.4/high': {
        displayName: 'GPT-5.4 High',
      },
    });
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
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, 'Add Custom Provider').trigger('click');
    await flushPromises();

    await wrapper.find('input[placeholder="e.g. My Local LLM"]').setValue('Anthropic Mirror');
    await selectSettingsOption(wrapper, 'Type', 'Anthropic Compatible');
    await wrapper.find('input[placeholder="Enter API Key"]').setValue('test-key');
    await findButtonByText(wrapper, 'Save Provider').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Anthropic Mirror',
        type: 'anthropic-compatible',
        api_key: 'test-key',
      })
    );
  });

  it('shows an API format note for custom providers and updates it when the type changes', async () => {
    const list = vi.fn(async () => []);

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
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, 'Add Custom Provider').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('API Format');
    expect(wrapper.text()).toContain('Responses (/responses)');
    expect(wrapper.text()).toContain(
      'Runtime adapter: Pi-AI (OpenAI Responses dialect) against your base URL.'
    );

    await wrapper.find('.provider-format-section .settings-select-trigger').trigger('click');
    await flushPromises();

    const completionsOption = wrapper
      .findAll('.provider-format-section .settings-select-option')
      .find(candidate =>
        candidate.text().replace(/\s+/g, ' ').includes('Chat Completions (/chat/completions)')
      );

    if (!completionsOption) {
      throw new Error('Chat Completions API format option not found');
    }

    await completionsOption.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'This selection sends OpenAI-compatible Chat Completions requests to your configured base URL. Switch to Responses when your gateway exposes it.'
    );
    expect(wrapper.text()).toContain(
      'Runtime adapter: Pi-AI (OpenAI Chat Completions dialect) against your base URL.'
    );

    await selectSettingsOption(wrapper, 'Type', 'Anthropic Compatible');

    expect(wrapper.text()).toContain('Messages (/messages)');
    expect(wrapper.text()).toContain(
      'Use this when your gateway exposes an Anthropic Messages endpoint.'
    );
    expect(wrapper.text()).toContain(
      'Runtime adapter: Pi-AI (Anthropic Messages dialect) against your base URL.'
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
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
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

  it('persists the responses API format for custom OpenAI-compatible providers', async () => {
    const list = vi.fn(async () => []);
    const add = vi.fn(async () => ({ id: 'custom_177' }));

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
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, 'Add Custom Provider').trigger('click');
    await flushPromises();

    await wrapper.find('input[placeholder="e.g. My Local LLM"]').setValue('Responses Gateway');
    await selectSettingsOption(wrapper, 'Type', 'OpenAI Compatible');
    await wrapper.find('.provider-format-section .settings-select-trigger').trigger('click');
    await flushPromises();

    const responsesOption = wrapper
      .findAll('.provider-format-section .settings-select-option')
      .find(candidate => candidate.text().replace(/\s+/g, ' ').includes('Responses (/responses)'));

    if (!responsesOption) {
      throw new Error('Responses API format option not found');
    }

    await responsesOption.trigger('click');
    await flushPromises();
    await wrapper.find('input[placeholder="Enter API Key"]').setValue('responses-key');
    await findButtonByText(wrapper, 'Save Provider').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Responses Gateway',
        type: 'openai-compatible',
        api_key: 'responses-key',
        is_response_api: true,
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
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
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

  it('shows enabled status feedback in the sidebar dot and details badge before saving', async () => {
    setElectronApi({
      providers: {
        list: vi.fn(async () => []),
        add: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      chat: {
        getModels: vi.fn(async () => []),
      },
    });

    const wrapper = mount(ProvidersSettings, {
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
        },
      },
    });

    await flushPromises();

    const findDeepSeekRow = () => {
      const match = wrapper
        .findAll('.provider-list-item')
        .find(item => item.text().includes('DeepSeek'));

      if (!match) {
        throw new Error('DeepSeek provider row not found');
      }

      return match;
    };

    await findDeepSeekRow().trigger('click');
    await flushPromises();

    expect(wrapper.find('.status-badge').text()).toContain('Inactive');
    expect(wrapper.find('.status-badge').classes()).not.toContain('enabled');
    expect(findDeepSeekRow().find('.provider-status-dot').classes()).not.toContain('enabled');

    await wrapper.find('.provider-switch input').setValue(true);
    await flushPromises();

    expect(wrapper.find('.status-badge').text()).toContain('Active');
    expect(wrapper.find('.status-badge').classes()).toContain('enabled');
    expect(findDeepSeekRow().find('.provider-status-dot').classes()).toContain('enabled');
  });

  it('places enabled providers at the top of the sidebar even when they are custom providers', async () => {
    setElectronApi({
      providers: {
        list: vi.fn(async () => [
          {
            id: 'custom_proxy_1',
            name: 'Proxy Gateway',
            type: 'openai-compatible',
            api_key: 'proxy-key',
            models: '["proxy-model"]',
            base_url: 'https://proxy.example.com/v1',
            enabled: true,
            created_at: '2026-03-21T12:00:00.000Z',
            updated_at: '2026-03-21T12:00:00.000Z',
            available_models: '["proxy-model"]',
          },
        ]),
        add: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      chat: {
        getModels: vi.fn(async () => []),
      },
    });

    const wrapper = mount(ProvidersSettings, {
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
        },
      },
    });

    await flushPromises();

    const providerNames = wrapper
      .findAll('.provider-list-item')
      .map(item => item.find('.provider-item-name').text().trim());

    expect(providerNames[0]).toBe('Proxy Gateway');
  });

  it('persists per-model options alongside the provider configuration', async () => {
    const update = vi.fn(async () => ({}));
    const list = vi.fn(async () => [
      {
        id: 'openai_1',
        name: 'OpenAI',
        type: 'openai',
        api_key: 'saved-key',
        models: '["gpt-5.4"]',
        model_options: '{}',
        base_url: 'https://api.openai.com/v1',
        enabled: true,
        created_at: '2026-03-21T12:00:00.000Z',
        updated_at: '2026-03-21T12:00:00.000Z',
        available_models: '["gpt-5.4"]',
      },
    ]);

    setElectronApi({
      providers: {
        list,
        add: vi.fn(),
        update,
        delete: vi.fn(),
      },
      chat: {
        getModels: vi.fn(async () => []),
      },
    });

    const wrapper = mount(ProvidersSettings, {
      attachTo: document.body,
      global: {
        stubs: {
          LobeIcon: true,
          BookOpen: true,
          ChevronDown: true,
          ExternalLink: true,
          Eye: true,
          EyeOff: true,
          RefreshCw: true,
          DialogPortal: { template: '<div><slot /></div>' },
        },
      },
    });

    await flushPromises();
    await wrapper.find('.provider-models-toggle').trigger('click');
    await flushPromises();
    await wrapper.find('.model-options-btn').trigger('click');
    await flushPromises();

    await findLabelByText(wrapper, 'Display Name').find('input').setValue('GPT-5.4 Gateway');
    await findLabelByText(wrapper, 'Context Window').find('input').setValue('400000');
    await selectSettingsOption(wrapper, 'Tool Calling', 'Enabled');
    await selectSettingsOption(wrapper, 'Reasoning', 'Enabled');
    await wrapper
      .find('.model-options-json-field textarea')
      .setValue('{"reasoningEffort":"medium","parallelToolCalls":true}');
    await wrapper.find('.model-options-editor .primary-btn').trigger('click');
    await flushPromises();

    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(update).toHaveBeenCalledTimes(1);
    const [, payload] = update.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        models: '["gpt-5.4"]',
      })
    );
    expect(JSON.parse(payload.model_options as string)).toEqual({
      'gpt-5.4': {
        contextWindow: 400000,
        displayName: 'GPT-5.4 Gateway',
        providerOptions: {
          parallelToolCalls: true,
          reasoningEffort: 'medium',
        },
        supportsReasoning: true,
        supportsToolCalls: true,
      },
    });
  });
});
