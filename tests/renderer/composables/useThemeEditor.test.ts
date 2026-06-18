import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useThemeEditor } from '../../../packages/desktop/src/renderer/composables/useThemeEditor';
import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import { listThemePresetSummaries, THEME_QUICK_STARTS } from '@iki/theme/registry';
import {
  cloneBase46ThemeDocument,
  createBase46ThemePresetFromQuickStart,
} from '@iki/theme/theme_creator';

const createHarness = () => {
  const config = ref(createDefaultAppConfig());
  const onConfigChange = vi.fn();
  const themePresetSummaries = computed(() =>
    listThemePresetSummaries(config.value.themes.base46Presets)
  );

  return {
    config,
    onConfigChange,
    ...useThemeEditor({
      config,
      themePresetSummaries,
      onConfigChange,
    }),
  };
};

describe('useThemeEditor', () => {
  it('seeds create-mode from the active theme and reapplies quick starts when the variant changes', () => {
    const harness = createHarness();
    harness.config.value.general.theme = 'light';

    harness.openCreateThemeModal();

    expect(harness.editor.open).toBe(true);
    expect(harness.editor.label).toBe('Ocean');
    expect(harness.editor.type).toBe('light');
    expect(harness.editor.quickStartId).toBe('ocean');
    expect(harness.editor.simple.background).toBe(THEME_QUICK_STARTS[0].light.background);

    harness.setEditorType('dark');

    expect(harness.editor.type).toBe('dark');
    expect(harness.editor.quickStartId).toBe('ocean');
    expect(harness.editor.simple.background).toBe(THEME_QUICK_STARTS[0].dark.background);
  });

  it('preserves the opposite preset variant when editing and saving a custom theme', () => {
    const harness = createHarness();
    const preset = createBase46ThemePresetFromQuickStart(THEME_QUICK_STARTS[0]);
    preset.label = 'Midnight Lab';
    harness.config.value.general.theme = 'light';
    harness.config.value.themes.base46Presets['midnight-lab'] = preset;

    const originalDark = cloneBase46ThemeDocument(preset.dark);

    harness.openEditThemeModal('midnight-lab');
    harness.setEditorMode('simple');
    harness.updateSimpleColor('accent', '#123456');
    harness.saveTheme();

    const savedPreset = harness.config.value.themes.base46Presets['midnight-lab'];

    expect(harness.onConfigChange).toHaveBeenCalledTimes(1);
    expect(harness.config.value.general.themePresetId).toBe('midnight-lab');
    expect(harness.editor.open).toBe(false);
    expect(savedPreset.dark).toEqual(originalDark);
    expect(savedPreset.light?.base_30.blue).toBe('#123456');
  });

  it('surfaces label validation errors instead of mutating config', () => {
    const harness = createHarness();

    harness.openCreateThemeModal();
    harness.editor.label = '   ';
    harness.saveTheme();

    expect(harness.onConfigChange).not.toHaveBeenCalled();
    expect(harness.editor.error).toBe('Display name is required.');
    expect(Object.keys(harness.config.value.themes.base46Presets)).toHaveLength(0);
  });
});
