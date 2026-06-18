import { mixHexColors, normalizeHexColor, readableTextColor } from './color_utils';
import type {
  AdvancedThemeSeed,
  Base46ThemeDocument,
  Base46ThemePresetInput,
  SimpleThemeSeed,
  ThemeQuickStartDefinition,
  ThemeVariant,
} from './types';

const normalizeSimpleSeed = (seed: SimpleThemeSeed): SimpleThemeSeed => ({
  background: normalizeHexColor(seed.background),
  text: normalizeHexColor(seed.text),
  accent: normalizeHexColor(seed.accent),
  secondary: normalizeHexColor(seed.secondary),
});

export const createAdvancedThemeSeedFromSimpleSeed = (
  seed: SimpleThemeSeed,
  type: ThemeVariant
): AdvancedThemeSeed => {
  const normalized = normalizeSimpleSeed(seed);
  const mixRatio = type === 'light' ? 0.08 : 0.12;
  const surface = mixHexColors(normalized.background, normalized.text, mixRatio);
  const surfaceAlt = mixHexColors(normalized.background, normalized.text, mixRatio * 1.6);
  const hover = mixHexColors(surfaceAlt, normalized.accent, type === 'light' ? 0.08 : 0.12);
  const muted = mixHexColors(normalized.text, normalized.background, type === 'light' ? 0.48 : 0.58);
  const warning = mixHexColors(normalized.secondary, '#f59e0b', 0.55);
  const danger = mixHexColors(normalized.accent, '#ef4444', 0.6);

  return {
    ...normalized,
    surface,
    surfaceAlt,
    hover,
    muted,
    warning,
    danger,
  };
};

const deriveLightGrey = (seed: AdvancedThemeSeed, type: ThemeVariant): string =>
  mixHexColors(seed.text, seed.muted, type === 'light' ? 0.36 : 0.42);

export const createBase46ThemeDocumentFromAdvancedSeed = ({
  name,
  type,
  seed,
}: {
  name: string;
  type: ThemeVariant;
  seed: AdvancedThemeSeed;
}): Base46ThemeDocument => {
  const normalized: AdvancedThemeSeed = {
    background: normalizeHexColor(seed.background),
    surface: normalizeHexColor(seed.surface),
    surfaceAlt: normalizeHexColor(seed.surfaceAlt),
    hover: normalizeHexColor(seed.hover),
    text: normalizeHexColor(seed.text),
    muted: normalizeHexColor(seed.muted),
    accent: normalizeHexColor(seed.accent),
    secondary: normalizeHexColor(seed.secondary),
    warning: normalizeHexColor(seed.warning),
    danger: normalizeHexColor(seed.danger),
  };

  const lightGrey = deriveLightGrey(normalized, type);
  const line = mixHexColors(normalized.surfaceAlt, normalized.text, type === 'light' ? 0.12 : 0.08);
  const blueAlt = mixHexColors(normalized.accent, normalized.text, type === 'light' ? 0.16 : 0.12);
  const greenAlt = mixHexColors(normalized.secondary, normalized.text, type === 'light' ? 0.14 : 0.18);
  const purple = mixHexColors(normalized.accent, '#a855f7', 0.52);
  const teal = mixHexColors(normalized.secondary, '#14b8a6', 0.46);
  const cyan = mixHexColors(normalized.accent, '#22d3ee', 0.42);
  const orange = mixHexColors(normalized.warning, '#f97316', 0.38);
  const black2 = mixHexColors(normalized.background, normalized.surface, 0.32);
  const darkerBlack =
    type === 'light'
      ? mixHexColors(normalized.background, '#f3f4f6', 0.55)
      : mixHexColors(normalized.background, '#000000', 0.18);
  const folderBg = normalized.accent;
  const accentContrast = readableTextColor(normalized.accent);

  return {
    name,
    type,
    base_30: {
      white: normalized.text,
      black: normalized.background,
      darker_black: darkerBlack,
      black2,
      one_bg: normalized.surface,
      one_bg2: normalized.surfaceAlt,
      one_bg3: normalized.hover,
      grey: normalized.muted,
      grey_fg: mixHexColors(normalized.muted, normalized.text, type === 'light' ? 0.18 : 0.14),
      grey_fg2: mixHexColors(normalized.muted, normalized.text, type === 'light' ? 0.28 : 0.24),
      light_grey: lightGrey,
      red: normalized.danger,
      baby_pink: mixHexColors(normalized.danger, accentContrast, 0.18),
      pink: mixHexColors(normalized.accent, '#f472b6', 0.46),
      line,
      green: normalized.secondary,
      vibrant_green: greenAlt,
      nord_blue: blueAlt,
      blue: normalized.accent,
      yellow: normalized.warning,
      sun: mixHexColors(normalized.warning, accentContrast, 0.14),
      purple,
      teal,
      orange,
      cyan,
      statusline_bg: normalized.surface,
      pmenu_bg: normalized.surfaceAlt,
      folder_bg: folderBg,
    },
    base_16: {
      base00: normalized.background,
      base01: darkerBlack,
      base02: normalized.surface,
      base03: normalized.surfaceAlt,
      base04: normalized.muted,
      base05: lightGrey,
      base06: mixHexColors(normalized.text, normalized.background, 0.16),
      base07: normalized.text,
      base08: normalized.danger,
      base09: orange,
      base0A: normalized.warning,
      base0B: normalized.secondary,
      base0C: cyan,
      base0D: normalized.accent,
      base0E: purple,
      base0F: mixHexColors(normalized.danger, orange, 0.4),
    },
  };
};

export const createBase46ThemeDocumentFromSimpleSeed = ({
  name,
  type,
  seed,
}: {
  name: string;
  type: ThemeVariant;
  seed: SimpleThemeSeed;
}): Base46ThemeDocument =>
  createBase46ThemeDocumentFromAdvancedSeed({
    name,
    type,
    seed: createAdvancedThemeSeedFromSimpleSeed(seed, type),
  });

export const createBase46ThemePresetFromQuickStart = (
  definition: ThemeQuickStartDefinition
): Base46ThemePresetInput => ({
  label: definition.label,
  dark: createBase46ThemeDocumentFromSimpleSeed({
    name: `${definition.label} Dark`,
    type: 'dark',
    seed: definition.dark,
  }),
  light: createBase46ThemeDocumentFromSimpleSeed({
    name: `${definition.label} Light`,
    type: 'light',
    seed: definition.light,
  }),
});

export const cloneBase46ThemeDocument = (
  document: Base46ThemeDocument | undefined
): Base46ThemeDocument | undefined =>
  document
    ? {
        ...document,
        base_30: { ...document.base_30 },
        base_16: { ...document.base_16 },
      }
    : undefined;

export const cloneBase46ThemePresetInput = (
  preset: Base46ThemePresetInput
): Base46ThemePresetInput => ({
  label: preset.label,
  dark: cloneBase46ThemeDocument(preset.dark),
  light: cloneBase46ThemeDocument(preset.light),
});

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'theme';

export const createThemePresetId = (label: string, existingIds: Iterable<string>): string => {
  const base = slugify(label);
  const set = new Set(existingIds);
  if (!set.has(base)) return base;

  let suffix = 2;
  while (set.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
};
