// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import SettingsView from '../../../src/renderer/views/SettingsView.vue';
import { useConfigStore } from '../../../src/renderer/store/config';
import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import type { Provider } from '../../../src/shared/types/provider';

const buildProvider = (
  overrides: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type' | 'models'>
): Provider => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type,
  api_key: overrides.api_key ?? '',
  models: overrides.models,
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

const mountSettingsView = async () => {
  const pinia = createPinia();
  setActivePinia(pinia);

  const store = useConfigStore();
  store.config = createDefaultAppConfig();
  store.initialized = true;

  const saveConfig = vi.spyOn(store, 'saveConfig').mockResolvedValue(undefined);
  const providersList = vi.fn(async () => [
    buildProvider({
      id: 'provider-openai',
      name: 'OpenAI',
      type: 'openai',
      models: JSON.stringify(['gpt-4o-mini']),
    }),
    buildProvider({
      id: 'provider-deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      models: JSON.stringify(['deepseek-chat', 'deepseek-reasoner']),
    }),
  ]);

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      providers: {
        list: providersList,
      },
    },
  });

  const wrapper = mount(SettingsView, {
    global: {
      plugins: [pinia],
      stubs: {
        ProvidersSettings: true,
        McpSettings: true,
        NapCatSettings: true,
        SettingsColorSchemeSection: true,
        SettingsSpeechSection: true,
        SettingsMemorySection: true,
        SettingsLifeSection: true,
        SettingsTasksSection: true,
        SettingsUsageSection: true,
        SettingsSkillsSection: true,
      },
    },
    attachTo: document.body,
  });

  await flushPromises();

  return { wrapper, store, saveConfig, providersList };
};

describe('SettingsView general custom selects', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
  });

  it('renders grouped tool model options in the shared settings select and updates the config', async () => {
    const { wrapper, store, saveConfig, providersList } = await mountSettingsView();

    expect(providersList).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.tool-model-select .settings-select-trigger').text()).toContain(
      'Auto-detect (Recommended)'
    );

    await wrapper.find('.tool-model-select .settings-select-trigger').trigger('click');

    expect(wrapper.find('.tool-model-select .settings-select-group-label').text()).toContain(
      'OpenAI'
    );

    const option = wrapper
      .findAll('.tool-model-select .settings-select-option')
      .find(candidate => candidate.text().includes('deepseek-chat'));

    if (!option) {
      throw new Error('deepseek-chat option not found');
    }

    await option.trigger('click');

    expect(store.config.toolModel.model).toBe('deepseek-chat');

    await vi.advanceTimersByTimeAsync(300);

    expect(saveConfig).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('renders shell approval as fixed always-on policy and still updates language', async () => {
    const { wrapper, store } = await mountSettingsView();

    expect(
      wrapper.find('.general-shell-approval-select .settings-select-trigger').text()
    ).toContain('Always Require Approval');
    expect(wrapper.find('.general-language-select .settings-select-trigger').text()).toContain(
      'English'
    );
    expect(store.config.toolExecution.shellApprovalMode).toBe('always');

    await wrapper.find('.general-language-select .settings-select-trigger').trigger('click');

    const languageOption = wrapper
      .findAll('.general-language-select .settings-select-option')
      .find(candidate => candidate.text().includes('简体中文'));

    if (!languageOption) {
      throw new Error('Simplified Chinese option not found');
    }

    await languageOption.trigger('click');

    expect(store.config.general.language).toBe('zh-CN');

    wrapper.unmount();
  });
});
