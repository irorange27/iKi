// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const createApi = (providers: unknown[] = []) => ({
  app: { getVersion: vi.fn(async () => '0.0.2') },
  config: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
  providers: {
    list: vi.fn(async () => providers),
    add: vi.fn(async () => ({ id: 'openai_1' })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    onUpdated: vi.fn(() => vi.fn()),
  },
  chat: { getModels: vi.fn(async () => []) },
  mcp: { list: vi.fn(async () => []), onUpdated: vi.fn(() => vi.fn()) },
  napcat: { list: vi.fn(async () => []), onUpdated: vi.fn(() => vi.fn()) },
  skills: { list: vi.fn(async () => []) },
  speech: { status: vi.fn(async () => ({ available: false })) },
  memory: { getStatus: vi.fn(async () => ({})) },
  tasks: { list: vi.fn(async () => []) },
  usage: { summary: vi.fn(async () => ({})) },
  companion: { getSnapshot: vi.fn(async () => null), onSnapshot: vi.fn(() => vi.fn()) },
  keybindings: { list: vi.fn(async () => []) },
  workspaces: { list: vi.fn(async () => []) },
});

const mountSettings = async (initialSection = 'models') => {
  const { default: SettingsView } = await import(
    '../../../packages/desktop/src/renderer/views/SettingsView.vue'
  );
  const wrapper = mount(SettingsView, { props: { initialSection } });
  await flushPromises();
  return wrapper;
};

describe('SettingsView footer save and provider drafts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('flushes a dirty provider draft when the footer Save is clicked', async () => {
    const providerRow = {
      id: 'openai_1',
      name: 'OpenAI',
      type: 'openai',
      api_key: 'sk-saved',
      models: '["gpt-4.1"]',
      base_url: 'https://api.openai.com/v1',
      enabled: true,
      created_at: '2026-03-21T12:00:00.000Z',
      updated_at: '2026-03-21T12:00:00.000Z',
      available_models: '["gpt-4.1","o3"]',
    };
    const update = vi.fn(async () => ({}));
    setElectronApi({
      ...createApi([providerRow]),
      providers: {
        ...createApi([providerRow]).providers,
        list: vi.fn(async () => [providerRow]),
        update,
      },
    });

    const wrapper = await mountSettings();

    // Dirty the provider draft by toggling a model off.
    // The header must not claim everything is saved.
    expect(wrapper.text()).toContain('Unsaved');

    // Target the FOOTER's Save specifically — there is a second Save inside the
    // provider card, and clicking that one would prove nothing about the footer.
    const footerSave = wrapper.find('.settings-footer .footer-actions .primary');
    expect(footerSave.exists()).toBe(true);
    await footerSave.trigger('click');
    await flushPromises();

    // The footer's Save is what the user believes covers the whole page, so it
    // must have persisted the provider change.
    expect(update).toHaveBeenCalledTimes(1);
    const [, payload] = update.mock.calls[0];
    expect(JSON.parse(payload.models as string)).toEqual([]);

    await wrapper.unmount();
  });

  it('reports unsaved while a provider draft is dirty', async () => {
    setElectronApi(
      createApi([
        {
          id: 'openai_1',
          name: 'OpenAI',
          type: 'openai',
          api_key: 'sk-saved',
          models: '["gpt-4.1"]',
          base_url: 'https://api.openai.com/v1',
          enabled: true,
          created_at: '2026-03-21T12:00:00.000Z',
          updated_at: '2026-03-21T12:00:00.000Z',
          available_models: '["gpt-4.1"]',
        },
      ])
    );

    const wrapper = await mountSettings();
    expect(wrapper.text()).toContain('All changes saved');

    await wrapper.find('.provider-models-toggle').trigger('click');
    await flushPromises();
    await wrapper.find('.model-toggle input').setValue(false);
    await flushPromises();

    expect(wrapper.find('.settings-header-right').classes()).toContain('is-unsaved');
    expect(wrapper.text()).toContain('Unsaved');
    expect(wrapper.find('.settings-footer .save-status').exists()).toBe(false);

    await wrapper.unmount();
  });
});
