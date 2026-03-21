// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import type { Provider } from '../../../src/shared/types/provider';
import ChatModelSelector from '../../../src/renderer/components/ChatModelSelector.vue';

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
});
