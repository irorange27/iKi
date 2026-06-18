import { describe, expect, it } from 'vitest';

import { createDefaultAppConfig } from '@iki/core/config/defaults';
import { normalizeAppConfig } from '@iki/core/config/normalize';
import { compileBase46ThemeDocument } from '@iki/theme/base46_compile';
import { parseBase46ThemePresetInput } from '@iki/theme/base46_schema';
import { BUILTIN_BASE46_DEFAULT_PRESET } from '@iki/theme/builtins';
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_QUICK_STARTS,
  createDefaultThemeConfig,
  listThemePresetSummaries,
  resolveThemeSelection,
} from '@iki/theme/registry';
import { createBase46ThemePresetFromQuickStart } from '@iki/theme/theme_creator';

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

  it('keeps the builtin default preset valid under the same strict base46 schema as imported presets', () => {
    expect(() => parseBase46ThemePresetInput(BUILTIN_BASE46_DEFAULT_PRESET)).not.toThrow();
  });

  it('compiles generated base46 quick starts into semantic desktop theme slots', () => {
    const preset = createBase46ThemePresetFromQuickStart(oceanQuickStart);
    if (!preset.dark) {
      throw new Error('Expected Ocean quick start to include a dark variant.');
    }
    if (!preset.light) {
      throw new Error('Expected Ocean quick start to include a light variant.');
    }

    const darkPalette = compileBase46ThemeDocument(preset.dark);
    const lightPalette = compileBase46ThemeDocument(preset.light);

    expect(darkPalette.colorScheme).toBe('dark');
    expect(darkPalette.bgPrimary).toBe(preset.dark.base_30.black);
    expect(darkPalette.surfaceInsetHighlight).toMatch(/^inset 0 1px 0 rgba\(/);
    expect(darkPalette.surfaceShadowMd).toMatch(/^0 10px 24px rgba\(/);
    expect(darkPalette.accentColor).toBe(preset.dark.base_30.blue);
    expect(darkPalette.chatComposerSendBackground).toMatch(/^rgba\(/);
    expect(darkPalette.chatUserBubbleRadius).toBe('28px 10px 28px 28px');
    expect(lightPalette.colorScheme).toBe('light');
    expect(lightPalette.bgPrimary).toBe(preset.light.base_30.black);
    expect(lightPalette.surfaceInsetHighlight).toMatch(/^inset 0 1px 0 rgba\(/);
    expect(lightPalette.surfaceShadowMd).toMatch(/^0 8px 20px rgba\(/);
    expect(lightPalette.accentColor).toBe(preset.light.base_30.blue);
    expect(lightPalette.chatUserBubbleRadius).toBe('28px 10px 28px 28px');
  });

  it('keeps the builtin light preset outgoing bubble radius aligned with dark mode', () => {
    const selection = resolveThemeSelection({
      presetId: DEFAULT_THEME_PRESET_ID,
      themeMode: 'light',
      systemPrefersDark: false,
    });

    expect(selection.resolvedVariant).toBe('light');
    expect(selection.palette.chatUserBubbleRadius).toBe('28px 10px 28px 28px');
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
