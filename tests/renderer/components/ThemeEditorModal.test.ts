// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import ThemeEditorModal from '../../../packages/desktop/src/renderer/components/settings/ThemeEditorModal.vue';
import { applySimpleThemeSeed } from '@iki/core/theme/theme_editor';
import { THEME_QUICK_STARTS } from '@iki/core/theme/registry';
import type { ThemeEditorState } from '../../../packages/desktop/src/renderer/composables/useThemeEditor';
import type { ThemeQuickStartDefinition, ThemeVariant } from '@iki/core/theme/types';

const themeVariantOptions: Array<{ value: ThemeVariant; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

const createEditorState = (overrides: Partial<ThemeEditorState> = {}): ThemeEditorState => {
  const simple = {
    ...(overrides.type === 'light' ? THEME_QUICK_STARTS[0].light : THEME_QUICK_STARTS[0].dark),
    ...(overrides.simple ?? {}),
  };
  const advanced = {
    ...applySimpleThemeSeed(simple, overrides.type ?? 'dark').advanced,
    ...(overrides.advanced ?? {}),
  };

  return {
    open: true,
    editingPresetId: null,
    mode: 'simple',
    type: 'dark',
    label: 'Ocean',
    quickStartId: THEME_QUICK_STARTS[0].id,
    simple,
    advanced,
    error: '',
    ...overrides,
  };
};

const mountModal = (options?: {
  editor?: Partial<ThemeEditorState>;
  quickStarts?: ThemeQuickStartDefinition[];
  previewStyle?: Record<string, string>;
}) =>
  mount(ThemeEditorModal, {
    props: {
      editor: createEditorState(options?.editor),
      previewStyle: options?.previewStyle ?? {},
      quickStarts: options?.quickStarts ?? THEME_QUICK_STARTS,
      themeVariantOptions,
    },
    attachTo: document.body,
    global: {
      stubs: {
        SlidersHorizontal: true,
        Sparkles: true,
      },
    },
  });

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

const updateColorField = async (
  wrapper: VueWrapper,
  labelText: string,
  value: string
): Promise<void> => {
  const field = wrapper
    .findAll('.theme-color-field')
    .find(candidate => candidate.text().replace(/\s+/g, ' ').includes(labelText));

  if (!field) {
    throw new Error(`Theme color field not found: ${labelText}`);
  }

  await field.find('input[type="color"]').setValue(value);
  await flushPromises();
};

const findButtonByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

describe('ThemeEditorModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('emits editor actions from the modal controls and keeps the preview label in sync with props', async () => {
    const wrapper = mountModal({
      quickStarts: THEME_QUICK_STARTS.slice(0, 2),
    });

    expect(wrapper.text()).toContain('Preview');
    expect(wrapper.text()).toContain('Ocean');

    await wrapper.find('input[placeholder="Ocean"]').setValue('Midnight Lab');
    await selectSettingsOption(wrapper, 'Type', 'Light');
    await findButtonByText(wrapper, 'Forest').trigger('click');
    await findButtonByText(wrapper, 'Advanced').trigger('click');
    await wrapper.find('.mini-icon-btn').trigger('click');
    await wrapper.find('.primary-btn').trigger('click');

    expect(wrapper.emitted('update-label')).toEqual([['Midnight Lab']]);
    expect(wrapper.emitted('set-editor-type')).toEqual([['light']]);
    expect(wrapper.emitted('apply-quick-start')).toEqual([['forest']]);
    expect(wrapper.emitted('set-editor-mode')).toEqual([['advanced']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.emitted('save')).toHaveLength(1);

    wrapper.unmount();
  });

  it('emits simple and advanced color updates through ThemeColorField interactions', async () => {
    const simpleWrapper = mountModal();

    await updateColorField(simpleWrapper, 'Background', '#112233');

    expect(simpleWrapper.emitted('update-simple-color')).toEqual([
      [{ key: 'background', value: '#112233' }],
    ]);

    simpleWrapper.unmount();

    const advancedWrapper = mountModal({
      editor: {
        mode: 'advanced',
        quickStartId: null,
      },
    });

    await updateColorField(advancedWrapper, 'Surface', '#334455');

    expect(advancedWrapper.emitted('update-advanced-color')).toEqual([
      [{ key: 'surface', value: '#334455' }],
    ]);

    advancedWrapper.unmount();
  });
});
