// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import WelcomeScreen from '../../../src/renderer/components/WelcomeScreen.vue';
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
  created_at: overrides.created_at ?? '2026-04-09T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-04-09T00:00:00.000Z',
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

describe('WelcomeScreen', () => {
  const openSettings = vi.fn();
  const listProviders = vi.fn<() => Promise<Provider[]>>();
  const isProviderConfigured = vi.fn<(providerType: string, providerId?: string) => Promise<boolean>>();
  const removeProviderListener = vi.fn();
  let providerUpdatedHandler: (() => void) | null = null;

  beforeEach(() => {
    openSettings.mockReset();
    listProviders.mockReset();
    isProviderConfigured.mockReset();
    removeProviderListener.mockReset();
    providerUpdatedHandler = null;

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        providers: {
          list: listProviders,
          onUpdated: vi.fn((handler: () => void) => {
            providerUpdatedHandler = handler;
            return removeProviderListener;
          }),
        },
        chat: {
          isProviderConfigured,
        },
        openSettings,
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
  });

  it('sends first-run users straight to provider settings when no provider is ready', async () => {
    listProviders.mockResolvedValue([]);
    isProviderConfigured.mockResolvedValue(false);

    const wrapper = mount(WelcomeScreen);
    await flushPromises();

    expect(wrapper.text()).toContain('Connect First Provider');

    await wrapper.find('.welcome-primary-btn').trigger('click');

    expect(openSettings).toHaveBeenCalledWith('provider');

    wrapper.unmount();
  });

  it('offers a first hello once a configured provider and model are ready', async () => {
    listProviders.mockResolvedValue([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        api_key: 'secret',
        models: JSON.stringify(['gpt-4.1-mini']),
      }),
    ]);
    isProviderConfigured.mockResolvedValue(true);

    const wrapper = mount(WelcomeScreen, {
      props: {
        activeProviderId: 'provider-openai',
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('First model ready');
    expect(wrapper.text()).toContain('give iKi a project, a goal, or pasted text');
    expect(wrapper.text()).toContain('Ready Now');
    expect(wrapper.text()).toContain('OpenAI');
    expect(wrapper.text()).toContain('gpt-4.1-mini');
    expect(wrapper.text()).toContain('Good First Context');
    expect(wrapper.text()).toContain('Names & Tone');
    expect(wrapper.text()).toContain('Project Folder');
    expect(wrapper.text()).toContain('Current Task');
    expect(wrapper.text()).toContain('Pasted Text');
    expect(wrapper.findAll('.welcome-prompt-btn')).toHaveLength(4);
    expect(wrapper.find('.welcome-primary-btn').text()).toContain('Start First Chat');

    await wrapper.find('.welcome-primary-btn').trigger('click');

    const firstEmission = wrapper.emitted('compose-starter')?.[0]?.[0];
    expect(firstEmission).toBe(
      'Speak with me naturally and start in a warm, low-pressure way. First help us establish how we should address each other: ask what I want to call you, what kind of presence I want you to be, what tone I prefer, how you should address me, and whether I want a small emoji or symbol. Keep it conversational rather than form-like.'
    );

    wrapper.unmount();
    expect(removeProviderListener).toHaveBeenCalledTimes(1);
  });

  it('surfaces a provider success milestone and next step before any model is available', async () => {
    listProviders.mockResolvedValue([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        api_key: 'secret',
        models: '[]',
      }),
    ]);
    isProviderConfigured.mockResolvedValue(true);

    const wrapper = mount(WelcomeScreen, {
      props: {
        activeProviderId: 'provider-openai',
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('First provider connected');
    expect(wrapper.text()).toContain('OpenAI is ready');
    expect(wrapper.text()).toContain('expose one model');
    expect(wrapper.text()).toContain('Finish Provider Setup');

    wrapper.unmount();
  });

  it('lets users dismiss the current milestone without blocking a later milestone stage', async () => {
    listProviders.mockResolvedValue([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        api_key: 'secret',
        models: '[]',
      }),
    ]);
    isProviderConfigured.mockResolvedValue(true);

    const wrapper = mount(WelcomeScreen, {
      props: {
        activeProviderId: 'provider-openai',
      },
    });
    await flushPromises();

    expect(wrapper.find('.welcome-milestone').exists()).toBe(true);

    await wrapper.find('.welcome-message-dismiss').trigger('click');

    expect(wrapper.find('.welcome-milestone').exists()).toBe(false);

    listProviders.mockResolvedValue([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        api_key: 'secret',
        models: JSON.stringify(['gpt-4.1-mini']),
      }),
    ]);

    providerUpdatedHandler?.();
    await flushPromises();

    expect(wrapper.find('.welcome-milestone').exists()).toBe(true);
    expect(wrapper.find('.welcome-milestone').text()).toContain('First model ready');

    wrapper.unmount();
  });
});
