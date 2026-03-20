// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import SettingsColorSchemeSection from '../../../src/renderer/components/settings/SettingsColorSchemeSection.vue';
import { useConfigStore } from '../../../src/renderer/store/config';

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

describe('SettingsColorSchemeSection', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    Reflect.deleteProperty(window, 'confirm');
  });

  it('updates the selected preset when a built-in theme card is chosen', async () => {
    const wrapper = mount(SettingsColorSchemeSection, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
        stubs: {
          Check: true,
          MonitorCog: true,
          Moon: true,
          Palette: true,
          Pencil: true,
          Plus: true,
          Search: true,
          SlidersHorizontal: true,
          Sparkles: true,
          Sun: true,
          Trash2: true,
        },
      },
    });

    const store = useConfigStore(pinia);

    await flushPromises();
    await findButtonByText(wrapper, 'Aquarium').trigger('click');

    expect(store.config.general.themePresetId).toBe('aquarium');
    expect(wrapper.emitted('config-change')).toHaveLength(1);
  });

  it('creates and selects a custom theme from the modal editor', async () => {
    const wrapper = mount(SettingsColorSchemeSection, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
        stubs: {
          Check: true,
          MonitorCog: true,
          Moon: true,
          Palette: true,
          Pencil: true,
          Plus: true,
          Search: true,
          SlidersHorizontal: true,
          Sparkles: true,
          Sun: true,
          Trash2: true,
        },
      },
    });

    const store = useConfigStore(pinia);

    await flushPromises();
    await findButtonByText(wrapper, 'Create Theme').trigger('click');
    await flushPromises();

    const labelInput = wrapper.find('input[placeholder="Ocean"]');
    await labelInput.setValue('Midnight Lab');
    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(store.config.themes.base46Presets['midnight-lab']).toBeDefined();
    expect(store.config.themes.base46Presets['midnight-lab']?.label).toBe('Midnight Lab');
    expect(store.config.general.themePresetId).toBe('midnight-lab');
    expect(wrapper.emitted('config-change')).toHaveLength(1);
  });
});
