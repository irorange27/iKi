import { compileBase46ThemeDocument } from './base46_compile';
import { parseBase46ThemePresetInput } from './base46_schema';
import {
  BUILTIN_BASE46_GALLERY_PRESETS,
  BUILTIN_THEME_PRESET,
  DEFAULT_THEME_PRESET_ID,
} from './builtins';
import type {
  Base46ThemePresetInput,
  ResolvedThemeSelection,
  ThemeMode,
  ThemePreset,
  ThemePresetSummary,
  ThemeVariant,
} from './types';

const pickDefaultVariant = (
  variants: ThemePreset['variants'],
  fallback: ThemeVariant = 'dark'
): ThemeVariant => {
  if (variants[fallback]) return fallback;
  if (variants.light) return 'light';
  return 'dark';
};

const compileBase46Preset = (
  id: string,
  input: Base46ThemePresetInput,
  source: ThemePreset['source'] = 'base46'
): ThemePreset => {
  const parsed = parseBase46ThemePresetInput(input);
  const variants: ThemePreset['variants'] = {};

  if (parsed.light) {
    variants.light = compileBase46ThemeDocument(parsed.light);
  }
  if (parsed.dark) {
    variants.dark = compileBase46ThemeDocument(parsed.dark);
  }

  return {
    id,
    label: parsed.label,
    source,
    variants,
    defaultVariant: pickDefaultVariant(variants),
  };
};

export const buildThemePresetRegistry = (
  base46Presets: Record<string, Base46ThemePresetInput> = {}
): Map<string, ThemePreset> => {
  const registry = new Map<string, ThemePreset>();
  registry.set(BUILTIN_THEME_PRESET.id, BUILTIN_THEME_PRESET);

  for (const [id, input] of Object.entries(BUILTIN_BASE46_GALLERY_PRESETS)) {
    registry.set(id, compileBase46Preset(id, input, 'builtin'));
  }

  for (const [id, input] of Object.entries(base46Presets)) {
    try {
      registry.set(id, compileBase46Preset(id, input));
    } catch {
      // Invalid custom themes are ignored at runtime and fall back to the builtin preset.
    }
  }

  return registry;
};

export const listThemePresetSummaries = (
  base46Presets: Record<string, Base46ThemePresetInput> = {}
): ThemePresetSummary[] =>
  Array.from(buildThemePresetRegistry(base46Presets).values()).map(preset => ({
    id: preset.id,
    label: preset.label,
    source: preset.source,
    variants: (Object.keys(preset.variants) as ThemeVariant[]).filter(variant =>
      Boolean(preset.variants[variant])
    ),
    defaultVariant: preset.defaultVariant,
  }));

export const resolveRequestedThemeVariant = (
  themeMode: ThemeMode,
  systemPrefersDark: boolean
): ThemeVariant => {
  if (themeMode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return themeMode;
};

export const resolveThemeSelection = ({
  presetId,
  themeMode,
  systemPrefersDark,
  base46Presets = {},
}: {
  presetId?: string | null;
  themeMode: ThemeMode;
  systemPrefersDark: boolean;
  base46Presets?: Record<string, Base46ThemePresetInput>;
}): ResolvedThemeSelection => {
  const registry = buildThemePresetRegistry(base46Presets);
  const requestedVariant = resolveRequestedThemeVariant(themeMode, systemPrefersDark);
  const requestedPreset =
    (presetId && registry.get(presetId)) || registry.get(DEFAULT_THEME_PRESET_ID);

  if (!requestedPreset) {
    throw new Error('Missing builtin theme preset.');
  }

  const resolvedVariant = requestedPreset.variants[requestedVariant]
    ? requestedVariant
    : requestedPreset.defaultVariant;
  const palette = requestedPreset.variants[resolvedVariant];

  if (!palette) {
    const builtinPreset = registry.get(DEFAULT_THEME_PRESET_ID);
    if (!builtinPreset?.variants.dark) {
      throw new Error('Missing fallback builtin dark theme palette.');
    }
    return {
      requestedVariant,
      resolvedVariant: 'dark',
      presetId: DEFAULT_THEME_PRESET_ID,
      presetLabel: builtinPreset.label,
      palette: builtinPreset.variants.dark,
    };
  }

  return {
    requestedVariant,
    resolvedVariant,
    presetId: requestedPreset.id,
    presetLabel: requestedPreset.label,
    palette,
  };
};

export {
  DEFAULT_THEME_PRESET_ID,
  createDefaultThemeConfig,
  cloneThemeConfig,
  THEME_QUICK_STARTS,
} from './builtins';
