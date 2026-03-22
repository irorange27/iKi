import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useThemePresetGallery } from '../../../src/renderer/composables/useThemePresetGallery';
import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import { createBase46ThemePresetFromQuickStart } from '../../../src/shared/theme/theme_creator';
import { THEME_QUICK_STARTS } from '../../../src/shared/theme/registry';

const createHarness = (options?: { systemPrefersDark?: boolean }) => {
  const config = ref(createDefaultAppConfig());
  const onConfigChange = vi.fn();

  return {
    config,
    onConfigChange,
    ...useThemePresetGallery({
      config,
      onConfigChange,
      systemPrefersDark: () => options?.systemPrefersDark ?? true,
    }),
  };
};

describe('useThemePresetGallery', () => {
  it('falls back to the builtin preset and filters builtin/custom galleries from the search query', () => {
    const harness = createHarness({ systemPrefersDark: false });
    const customPreset = createBase46ThemePresetFromQuickStart(THEME_QUICK_STARTS[0]);
    customPreset.label = 'Midnight Lab';

    harness.config.value.general.theme = 'system';
    harness.config.value.general.themePresetId = 'missing-preset';
    harness.config.value.themes.base46Presets['midnight-lab'] = customPreset;

    expect(harness.currentThemePresetId.value).toBe('iki-default');
    expect(harness.selectedPresetLabel.value).toBe('iKi Default');
    expect(harness.gallerySectionTitle.value).toBe('Light Theme Gallery');

    harness.searchQuery.value = 'midnight';

    expect(harness.filteredCustomPresetCards.value.map(preset => preset.id)).toEqual(['midnight-lab']);
    expect(harness.filteredBuiltinPresetCards.value).toEqual([]);
  });

  it('updates the config and emits change hooks when selecting theme mode or preset', () => {
    const harness = createHarness();
    harness.config.value.themes.base46Presets['midnight-lab'] = createBase46ThemePresetFromQuickStart(
      THEME_QUICK_STARTS[0]
    );

    harness.setThemeMode('dark');
    harness.selectThemePreset('midnight-lab');

    expect(harness.config.value.general.theme).toBe('dark');
    expect(harness.config.value.general.themePresetId).toBe('midnight-lab');
    expect(harness.onConfigChange).toHaveBeenCalledTimes(2);
  });
});
