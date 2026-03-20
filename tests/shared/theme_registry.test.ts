import { describe, expect, it } from 'vitest';

import { createDefaultAppConfig } from '../../src/shared/config/defaults';
import { normalizeAppConfig } from '../../src/shared/config/normalize';
import { compileBase46ThemeDocument } from '../../src/shared/theme/base46_compile';
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_QUICK_STARTS,
  createDefaultThemeConfig,
  listThemePresetSummaries,
  resolveThemeSelection,
} from '../../src/shared/theme/registry';
import { createBase46ThemePresetFromQuickStart } from '../../src/shared/theme/theme_creator';

const oceanQuickStart = THEME_QUICK_STARTS.find(preset => preset.id === 'ocean');

if (!oceanQuickStart) {
  throw new Error('Missing built-in Ocean quick start.');
}

describe('shared theme registry', () => {
  it('adds a default theme preset id and starts with no custom presets', () => {
    const config = createDefaultAppConfig();

    expect(config.general.themePresetId).toBe(DEFAULT_THEME_PRESET_ID);
    expect(config.themes).toEqual(createDefaultThemeConfig());
    expect(config.themes.base46Presets).toEqual({});
  });

  it('normalizes legacy config without theme preset data onto the builtin preset', () => {
    const config = normalizeAppConfig({
      general: {
        theme: 'dark',
      },
    });

    expect(config.general.themePresetId).toBe(DEFAULT_THEME_PRESET_ID);
    expect(config.themes.base46Presets).toEqual({});
  });

  it('lists builtin gallery presets alongside the default preset', () => {
    const summaries = listThemePresetSummaries();
    const presetIds = summaries.map(summary => summary.id);

    expect(presetIds).toContain(DEFAULT_THEME_PRESET_ID);
    expect(presetIds).toContain('aquarium');
    expect(presetIds).toContain('ashes');
    expect(presetIds).toContain('ayu');
    expect(summaries.find(summary => summary.id === 'aquarium')?.source).toBe('builtin');
  });

  it('compiles generated base46 quick starts into semantic desktop theme slots', () => {
    const preset = createBase46ThemePresetFromQuickStart(oceanQuickStart);
    if (!preset.dark) {
      throw new Error('Expected Ocean quick start to include a dark variant.');
    }

    const palette = compileBase46ThemeDocument(preset.dark);

    expect(palette.colorScheme).toBe('dark');
    expect(palette.bgPrimary).toBe(preset.dark.base_30.black);
    expect(palette.accentColor).toBe(preset.dark.base_30.blue);
    expect(palette.chatComposerSendBackground).toMatch(/^rgba\(/);
    expect(palette.chatUserBubbleRadius).toBe('28px 10px 28px 28px');
  });

  it('falls back to a preset default variant when the requested variant is unavailable', () => {
    const preset = createBase46ThemePresetFromQuickStart(oceanQuickStart);

    const selection = resolveThemeSelection({
      presetId: 'custom-dark-only',
      themeMode: 'light',
      systemPrefersDark: false,
      base46Presets: {
        'custom-dark-only': {
          label: 'Dark Only',
          dark: preset.dark,
        },
      },
    });

    expect(selection.requestedVariant).toBe('light');
    expect(selection.resolvedVariant).toBe('dark');
    expect(selection.presetId).toBe('custom-dark-only');
  });
});
