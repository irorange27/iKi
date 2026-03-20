import { describe, expect, it } from 'vitest';

import { createDefaultAppConfig } from '../../src/shared/config/defaults';
import { normalizeAppConfig } from '../../src/shared/config/normalize';
import { compileBase46ThemeDocument } from '../../src/shared/theme/base46_compile';
import {
  CUSTOM_BASE46_PRESET_ID,
  createDefaultThemeConfig,
  resolveThemeSelection,
} from '../../src/shared/theme/registry';

describe('shared theme registry', () => {
  it('adds a default theme preset id and bundled custom base46 starter preset to app config', () => {
    const config = createDefaultAppConfig();

    expect(config.general.themePresetId).toBe('iki-default');
    expect(config.themes.base46Presets[CUSTOM_BASE46_PRESET_ID]?.label).toBe('Custom Base46');
    expect(config.themes.base46Presets[CUSTOM_BASE46_PRESET_ID]?.dark?.type).toBe('dark');
    expect(config.themes.base46Presets[CUSTOM_BASE46_PRESET_ID]?.light?.type).toBe('light');
  });

  it('normalizes legacy config without theme preset data onto the builtin preset', () => {
    const config = normalizeAppConfig({
      general: {
        theme: 'dark',
      },
    });

    expect(config.general.themePresetId).toBe('iki-default');
    expect(config.themes.base46Presets[CUSTOM_BASE46_PRESET_ID]).toBeDefined();
  });

  it('compiles base46 documents into semantic desktop theme slots', () => {
    const preset = createDefaultThemeConfig().base46Presets[CUSTOM_BASE46_PRESET_ID];
    if (!preset.dark) {
      throw new Error('Expected bundled custom Base46 preset to include a dark variant.');
    }
    const palette = compileBase46ThemeDocument(preset.dark);

    expect(palette.colorScheme).toBe('dark');
    expect(palette.bgPrimary).toBe(preset.dark.base_30.black);
    expect(palette.accentColor).toBe(preset.dark.base_30.blue);
    expect(palette.chatComposerSendBackground).toMatch(/^rgba\(/);
    expect(palette.chatUserBubbleRadius).toBe('28px 10px 28px 28px');
  });

  it('falls back to a preset default variant when the requested variant is unavailable', () => {
    const selection = resolveThemeSelection({
      presetId: CUSTOM_BASE46_PRESET_ID,
      themeMode: 'light',
      systemPrefersDark: false,
      base46Presets: {
        [CUSTOM_BASE46_PRESET_ID]: {
          label: 'Dark Only',
          dark: createDefaultThemeConfig().base46Presets[CUSTOM_BASE46_PRESET_ID].dark,
        },
      },
    });

    expect(selection.requestedVariant).toBe('light');
    expect(selection.resolvedVariant).toBe('dark');
    expect(selection.presetId).toBe(CUSTOM_BASE46_PRESET_ID);
  });
});
