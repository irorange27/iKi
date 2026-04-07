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

const mountSettingsView = async (options?: {
  setupStore?: (store: ReturnType<typeof useConfigStore>) => void;
}) => {
  const pinia = createPinia();
  setActivePinia(pinia);

  const store = useConfigStore();
  store.config = createDefaultAppConfig();
  store.initialized = true;
  options?.setupStore?.(store);

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
  const getUpdateStatus = vi.fn(async () => ({
    state: 'idle',
    autoUpdateEnabled: true,
    supported: true,
    checkIntervalMs: 21600000,
    currentVersion: '0.0.1',
    lastCheckedAt: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    updateUrl: null,
    error: null,
    unsupportedReason: null,
  }));
  const checkUpdates = vi.fn(async () => ({
    state: 'checking',
    autoUpdateEnabled: true,
    supported: true,
    checkIntervalMs: 21600000,
    currentVersion: '0.0.1',
    lastCheckedAt: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    updateUrl: null,
    error: null,
    unsupportedReason: null,
  }));
  const installUpdate = vi.fn(async () => undefined);
  const removeUpdateStatusListener = vi.fn();
  const onUpdateStatusChanged = vi.fn(() => removeUpdateStatusListener);
  const onProvidersUpdated = vi.fn();
  const removeProviderListener = vi.fn();
  const setConfig = vi.fn(async () => ({ success: true }));

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      config: {
        set: setConfig,
      },
      updates: {
        getStatus: getUpdateStatus,
        check: checkUpdates,
        install: installUpdate,
        onStatusChanged: onUpdateStatusChanged,
        removeAllListeners: vi.fn(),
      },
      providers: {
        list: providersList,
        onUpdated: vi.fn((callback: unknown) => {
          onProvidersUpdated(callback);
          return removeProviderListener;
        }),
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
        SettingsNetworkSection: true,
        SettingsSpeechSection: true,
        SettingsMemorySection: true,
        SettingsTasksSection: true,
        SettingsUsageSection: true,
        SettingsSkillsSection: true,
      },
    },
    attachTo: document.body,
  });

  await flushPromises();

  return {
    wrapper,
    store,
    saveConfig,
    providersList,
    getUpdateStatus,
    checkUpdates,
    installUpdate,
    onProvidersUpdated,
    removeProviderListener,
  };
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
    const setToolModel = vi.spyOn(store, 'setToolModel');

    expect(providersList).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Prefer a low-latency model.');
    expect(wrapper.text()).toContain('Network');
    expect(wrapper.text()).not.toContain('Avoid reasoning models');
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

    expect(setToolModel).toHaveBeenCalledWith({
      providerType: 'deepseek',
      model: 'deepseek-chat',
    });
    expect(store.config.toolModel.providerType).toBe('deepseek');
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

  it('toggles automatic tool approval and disables the shell approval selector', async () => {
    const { wrapper, store, saveConfig } = await mountSettingsView();

    expect(wrapper.find('.general-auto-approve-switch').attributes('aria-checked')).toBe('false');
    expect(
      wrapper
        .find('.general-shell-approval-select .settings-select-trigger')
        .attributes('disabled')
    ).toBeUndefined();

    await wrapper.find('.general-auto-approve-switch').trigger('click');

    expect(store.config.general.autoApproveToolRequests).toBe(true);
    expect(wrapper.find('.general-auto-approve-switch').attributes('aria-checked')).toBe('true');
    expect(wrapper.text()).toContain('including shell commands');
    expect(
      wrapper
        .find('.general-shell-approval-select .settings-select-trigger')
        .attributes('disabled')
    ).toBeDefined();

    await vi.advanceTimersByTimeAsync(300);

    expect(saveConfig).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('renders updater status and allows a manual check', async () => {
    const { wrapper, getUpdateStatus, checkUpdates } = await mountSettingsView();

    expect(getUpdateStatus).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Automatic Updates');
    expect(wrapper.text()).toContain('Check Now');

    await wrapper.find('.general-update-check-btn').trigger('click');

    expect(checkUpdates).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('reloads provider-backed selects after a provider update broadcast', async () => {
    const { wrapper, providersList, onProvidersUpdated, removeProviderListener } =
      await mountSettingsView();

    const providerUpdateHandler = onProvidersUpdated.mock.calls[0]?.[0];
    if (typeof providerUpdateHandler !== 'function') {
      throw new Error('provider update handler was not registered');
    }

    vi.mocked(providersList).mockResolvedValueOnce([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        models: JSON.stringify(['gpt-4o-mini']),
      }),
      buildProvider({
        id: 'provider-custom',
        name: 'Custom Gateway',
        type: 'openai-compatible',
        models: JSON.stringify(['my-model']),
      }),
    ]);

    await providerUpdateHandler({
      action: 'added',
      providerId: 'provider-custom',
    });
    await flushPromises();

    expect(providersList).toHaveBeenCalledTimes(2);

    await wrapper.find('.tool-model-select .settings-select-trigger').trigger('click');

    expect(wrapper.text()).toContain('Custom Gateway');

    wrapper.unmount();

    expect(removeProviderListener).toHaveBeenCalledTimes(1);
  });
});
