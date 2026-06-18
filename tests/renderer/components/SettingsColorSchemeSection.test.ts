// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import SettingsColorSchemeSection from '../../../packages/desktop/src/renderer/components/settings/SettingsColorSchemeSection.vue';
import { useConfigStore } from '../../../packages/desktop/src/renderer/store/config';
import { THEME_QUICK_STARTS } from '@iki/core/theme/registry';
import { createBase46ThemePresetFromQuickStart } from '@iki/core/theme/theme_creator';

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

const findExactButtonByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').trim() === text);

  if (!match) {
    throw new Error(`Exact button not found: ${text}`);
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
    await selectSettingsOption(wrapper, 'Type', 'Light');
    await findButtonByText(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(store.config.themes.base46Presets['midnight-lab']).toBeDefined();
    expect(store.config.themes.base46Presets['midnight-lab']?.label).toBe('Midnight Lab');
    expect(store.config.themes.base46Presets['midnight-lab']?.light).toBeDefined();
    expect(store.config.themes.base46Presets['midnight-lab']?.dark).toBeUndefined();
    expect(store.config.general.themePresetId).toBe('midnight-lab');
    expect(wrapper.emitted('config-change')).toHaveLength(1);
  });

  it('deletes the active custom theme and falls back to the builtin preset', async () => {
    const store = useConfigStore(pinia);
    store.config.themes.base46Presets['midnight-lab'] = createBase46ThemePresetFromQuickStart(
      THEME_QUICK_STARTS[0]
    );
    store.config.themes.base46Presets['midnight-lab'].label = 'Midnight Lab';
    store.config.general.themePresetId = 'midnight-lab';

    const wrapper = mount(SettingsColorSchemeSection, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
        stubs: {
          MonitorCog: true,
          Moon: true,
          Palette: true,
          Plus: true,
          Search: true,
          SlidersHorizontal: true,
          Sparkles: true,
          Sun: true,
        },
      },
    });

    await flushPromises();
    await findExactButtonByText(wrapper, 'Delete').trigger('click');
    await flushPromises();

    expect(store.config.themes.base46Presets['midnight-lab']).toBeUndefined();
    expect(store.config.general.themePresetId).toBe('iki-default');
    expect(wrapper.emitted('config-change')).toHaveLength(1);
  });
});
