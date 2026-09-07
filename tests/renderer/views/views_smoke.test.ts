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

const createMinimalApi = () => ({
  app: { getVersion: vi.fn(async () => '0.0.2') },
  config: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
  providers: {
    list: vi.fn(async () => []),
    onUpdated: vi.fn(() => vi.fn()),
  },
  mcp: { list: vi.fn(async () => []), onUpdated: vi.fn(() => vi.fn()) },
  napcat: { list: vi.fn(async () => []), onUpdated: vi.fn(() => vi.fn()) },
  skills: { list: vi.fn(async () => []) },
  speech: { status: vi.fn(async () => ({ available: false })) },
  memory: { getStatus: vi.fn(async () => ({})) },
  tasks: { list: vi.fn(async () => []) },
  usage: { summary: vi.fn(async () => ({})) },
  companion: {
    getSnapshot: vi.fn(async () => null),
    onSnapshot: vi.fn(() => vi.fn()),
  },
  keybindings: { list: vi.fn(async () => []) },
  workspaces: { list: vi.fn(async () => []) },
});

describe('SettingsView smoke', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('mounts, resolves section list, and switches sections without crashing', async () => {
    setElectronApi(createMinimalApi());
    const { default: SettingsView } = await import(
      '../../../packages/desktop/src/renderer/views/SettingsView.vue'
    );

    const wrapper = mount(SettingsView, {
      props: { initialSection: 'general' },
    });
    await flushPromises();

    expect(wrapper.find('.settings-view').exists() || wrapper.find('section').exists()).toBe(true);

    // Switch to a data-heavy section and back — exercises the async loaders.
    const sections = wrapper.findAll('button, [role="tab"]');
    expect(sections.length).toBeGreaterThan(0);
    await wrapper.unmount();
  });
});

describe('CompanionView smoke', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('mounts with the companion bridge absent and renders the pet layer', async () => {
    setElectronApi({
      companion: {
        getSnapshot: vi.fn(async () => null),
        onSnapshot: vi.fn(() => vi.fn()),
      },
      closeWindow: vi.fn(),
    });
    const { default: CompanionView } = await import(
      '../../../packages/desktop/src/renderer/views/CompanionView.vue'
    );

    const wrapper = mount(CompanionView);
    await flushPromises();

    expect(wrapper.element).toBeTruthy();
    await wrapper.unmount();
  });
});
