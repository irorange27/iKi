// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import type { Provider } from '@iki/core/types/provider';
import ChatModelSelector from '../../../packages/desktop/src/renderer/components/ChatModelSelector.vue';

const buildProvider = (
  overrides: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type'>
): Provider => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type,
  api_key: overrides.api_key ?? '',
  models: overrides.models ?? '[]',
  base_url: overrides.base_url,
  enabled: overrides.enabled ?? true,
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
  available_models: overrides.available_models ?? '[]',
  api_version: overrides.api_version,
  is_response_api: overrides.is_response_api,
  acp_command: overrides.acp_command,
  acp_args: overrides.acp_args,
  acp_mcp_server_ids: overrides.acp_mcp_server_ids,
  acp_auth_method_id: overrides.acp_auth_method_id,
  acp_api_provider_id: overrides.acp_api_provider_id,
  acp_model_mapping: overrides.acp_model_mapping,
});

describe('ChatModelSelector', () => {
  it('filters provider models and emits the selected provider/model pair', async () => {
    const deepseek = buildProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      models: '["deepseek-chat"]',
    });
    const openai = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1","gpt-4o"]',
    });

    const wrapper = mount(ChatModelSelector, {
      props: {
        availableProviders: [deepseek, openai],
        selectedProvider: deepseek,
        selectedModel: 'deepseek-chat',
      },
      global: {
        stubs: {
          LobeIcon: true,
        },
      },
    });

    expect(wrapper.find('.model-selector-trigger').attributes('title')).toBe(
      'DeepSeek · deepseek-chat'
    );

    await wrapper.find('.model-selector-trigger').trigger('click');
    await flushPromises();

    const searchInput = wrapper.find('.model-selector-search-input');
    expect(searchInput.exists()).toBe(true);

    await searchInput.setValue('4o');
    await flushPromises();

    const modelOptions = wrapper.findAll('.model-option');
    expect(modelOptions).toHaveLength(1);
    expect(modelOptions[0].text()).toContain('gpt-4o');

    await modelOptions[0].trigger('click');
    await flushPromises();

    expect(wrapper.find('.model-selector-panel').exists()).toBe(false);
    expect(wrapper.emitted('select')).toEqual([
      [{ provider: openai, model: 'gpt-4o' }],
    ]);
  });

  it('uses the shared custom-provider icon fallback for custom providers', async () => {
    const customProvider = buildProvider({
      id: 'custom_proxy',
      name: 'Proxy Gateway',
      type: 'openai-compatible',
      models: '["proxy-model"]',
    });

    const wrapper = mount(ChatModelSelector, {
      props: {
        availableProviders: [customProvider],
        selectedProvider: customProvider,
        selectedModel: 'proxy-model',
      },
      global: {
        stubs: {
          LobeIcon: {
            props: ['name', 'cdnPrefix', 'useCdn', 'fallbackText'],
            template:
              '<div class="lobe-icon-stub" :data-name="name" :data-cdn-prefix="cdnPrefix || \'\'" :data-use-cdn="useCdn === undefined ? \'\' : String(useCdn)" :data-fallback-text="fallbackText || \'\'"></div>',
          },
        },
      },
    });

    expect(wrapper.find('.model-selector-trigger').attributes('title')).toBe(
      'Proxy Gateway · proxy-model'
    );

    const triggerIcon = wrapper.find('.model-selector-trigger-icon .lobe-icon-stub');
    expect(triggerIcon.attributes('data-name')).toBe('grid-2x2');
    expect(triggerIcon.attributes('data-cdn-prefix')).toBe(
      'https://unpkg.com/lucide-static@latest/icons'
    );
    expect(triggerIcon.attributes('data-use-cdn')).toBe('true');
    expect(triggerIcon.attributes('data-fallback-text')).toBe('PR');

    await wrapper.find('.model-selector-trigger').trigger('click');
    await flushPromises();

    const groupIcon = wrapper.find('.model-provider-icon .lobe-icon-stub');
    expect(groupIcon.attributes('data-name')).toBe('grid-2x2');
    expect(groupIcon.attributes('data-cdn-prefix')).toBe(
      'https://unpkg.com/lucide-static@latest/icons'
    );
    expect(groupIcon.attributes('data-use-cdn')).toBe('true');
    expect(groupIcon.attributes('data-fallback-text')).toBe('PR');
  });

  it('shows a chooser tooltip when no provider/model is selected', () => {
    const wrapper = mount(ChatModelSelector, {
      props: {
        availableProviders: [],
        selectedProvider: null,
        selectedModel: '',
      },
      global: {
        stubs: {
          LobeIcon: true,
        },
      },
    });

    expect(wrapper.find('.model-selector-trigger').attributes('title')).toBe('Choose model');
    expect(wrapper.find('.model-selector-trigger').attributes('aria-label')).toBe('Choose model');
  });
});
