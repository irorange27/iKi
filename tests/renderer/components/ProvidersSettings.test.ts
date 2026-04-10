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
    expect(wrapper.find('input[placeholder="https://api.openai.com/v1"]').exists()).toBe(true);

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

  it('surfaces Anthropic as a built-in provider with the official default base URL', async () => {
    const list = vi.fn(async () => []);
    const add = vi.fn(async () => ({ id: 'anthropic_176' }));

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

    const anthropicRow = wrapper
      .findAll('.provider-list-item')
      .find(item => item.text().includes('Anthropic'));

    if (!anthropicRow) {
      throw new Error('Anthropic provider row not found');
    }

    await anthropicRow.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Inactive');
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="https://api.anthropic.com/v1"]').exists()).toBe(true);

    const apiKeyInput = wrapper.find('input[type="password"]');
    await apiKeyInput.setValue('sk-ant-test');
    await wrapper.find('.provider-switch input').setValue(true);
    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^anthropic_\d+$/),
        name: 'Anthropic',
        type: 'anthropic',
        api_key: 'sk-ant-test',
        base_url: 'https://api.anthropic.com/v1',
        models: '[]',
        available_models: '[]',
        enabled: true,
      })
    );
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('surfaces MiniMax as a built-in provider with the official default base URL', async () => {
    const list = vi.fn(async () => []);
    const add = vi.fn(async () => ({ id: 'minimax_176' }));

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

    const minimaxRow = wrapper
      .findAll('.provider-list-item')
      .find(item => item.text().includes('MiniMax'));

    if (!minimaxRow) {
      throw new Error('MiniMax provider row not found');
    }

    await minimaxRow.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Inactive');
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(
      wrapper.find('input[placeholder="https://api.minimax.io/anthropic/v1"]').exists()
    ).toBe(true);

    const apiKeyInput = wrapper.find('input[type="password"]');
    await apiKeyInput.setValue('minimax-key');
    await wrapper.find('.provider-switch input').setValue(true);
    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^minimax_\d+$/),
        name: 'MiniMax',
        type: 'minimax',
        api_key: 'minimax-key',
        base_url: 'https://api.minimax.io/anthropic/v1',
        models: '[]',
        available_models: '[]',
        enabled: true,
      })
    );
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('surfaces ACP as a built-in provider and saves ACP runtime settings', async () => {
    const list = vi.fn(async () => []);
    const add = vi.fn(async () => ({ id: 'acp_176' }));

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

    const acpRow = wrapper
      .findAll('.provider-list-item')
      .find(item => item.text().includes('ACP Agent'));

    if (!acpRow) {
      throw new Error('ACP provider row not found');
    }

    await acpRow.trigger('click');
    await flushPromises();

    await wrapper.find('input[placeholder="e.g. codex-acp"]').setValue('codex-acp');
    await wrapper
      .find('textarea[placeholder="--profile default\n--sandbox workspace-write"]')
      .setValue('--sandbox\nworkspace-write');
    await wrapper.find('.provider-switch input').setValue(true);
    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^acp_\d+$/),
        name: 'ACP Agent',
        type: 'acp',
        acp_command: 'codex-acp',
        acp_args: '--sandbox\nworkspace-write',
        enabled: true,
      })
    );
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

    expect(wrapper.text()).toContain('API Format');
    expect(wrapper.text()).toContain('Chat Completions (/chat/completions)');
    expect(wrapper.text()).toContain(
      'Runtime adapter: AI SDK OpenAI-compatible provider against your custom base URL.'
    );

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

    expect(wrapper.text()).toContain(
      'Use this when your gateway exposes an OpenAI Responses endpoint.'
    );
    expect(wrapper.text()).toContain(
      'Runtime adapter: AI SDK OpenAI Responses provider with your custom base URL.'
    );

    await selectSettingsOption(wrapper, 'Type', 'Anthropic Compatible');

    expect(wrapper.text()).toContain('Messages (/messages)');
    expect(wrapper.text()).toContain(
      'Use this when your gateway exposes an Anthropic Messages endpoint.'
    );
    expect(wrapper.text()).toContain(
      'Runtime adapter: AI SDK Anthropic provider configured against your custom base URL.'
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
    await wrapper.find('.provider-models-toggle').trigger('click');
    await flushPromises();
    await findButtonByText(wrapper, 'Model Options').trigger('click');
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
