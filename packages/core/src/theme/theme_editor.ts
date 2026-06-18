import { compileBase46ThemeDocument } from './base46_compile';
import { normalizeHexColor } from './color_utils';
import {
  createAdvancedThemeSeedFromSimpleSeed,
  createBase46ThemeDocumentFromAdvancedSeed,
  createBase46ThemeDocumentFromSimpleSeed,
} from './theme_creator';
import type {
  AdvancedThemeSeed,
  Base46ThemeDocument,
  Base46ThemePresetInput,
  SimpleThemeSeed,
  ThemeSlotPalette,
  ThemeVariant,
} from './types';

export const createSimpleThemeSeedFromDocument = (
  document: Base46ThemeDocument
): SimpleThemeSeed => ({
  background: document.base_30.black,
  text: document.base_30.white,
  accent: document.base_30.blue,
  secondary: document.base_30.green,
});

export const createAdvancedThemeSeedFromDocument = (
  document: Base46ThemeDocument
): AdvancedThemeSeed => ({
  background: document.base_30.black,
  surface: document.base_30.one_bg,
  surfaceAlt: document.base_30.one_bg2,
  hover: document.base_30.one_bg3 || document.base_30.one_bg2,
  text: document.base_30.white,
  muted: document.base_30.grey,
  accent: document.base_30.blue,
  secondary: document.base_30.green,
  warning: document.base_30.yellow,
  danger: document.base_30.red,
});

const capitalizeWord = (value: string): string =>
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

export const createThemePreviewDocument = ({
  label,
  mode,
  type,
  simpleSeed,
  advancedSeed,
}: {
  label: string;
  mode: 'simple' | 'advanced';
  type: ThemeVariant;
  simpleSeed: SimpleThemeSeed;
  advancedSeed: AdvancedThemeSeed;
}): Base46ThemeDocument => {
  const resolvedLabel = label.trim() || 'Untitled Theme';

  if (mode === 'simple') {
    return createBase46ThemeDocumentFromSimpleSeed({
      name: `${resolvedLabel} ${capitalizeWord(type)}`,
      type,
      seed: {
        ...simpleSeed,
        background: normalizeHexColor(simpleSeed.background),
        text: normalizeHexColor(simpleSeed.text),
        accent: normalizeHexColor(simpleSeed.accent),
        secondary: normalizeHexColor(simpleSeed.secondary),
      },
    });
  }

  return createBase46ThemeDocumentFromAdvancedSeed({
    name: `${resolvedLabel} ${capitalizeWord(type)}`,
    type,
    seed: {
      ...advancedSeed,
      background: normalizeHexColor(advancedSeed.background),
      surface: normalizeHexColor(advancedSeed.surface),
      surfaceAlt: normalizeHexColor(advancedSeed.surfaceAlt),
      hover: normalizeHexColor(advancedSeed.hover),
      text: normalizeHexColor(advancedSeed.text),
      muted: normalizeHexColor(advancedSeed.muted),
      accent: normalizeHexColor(advancedSeed.accent),
      secondary: normalizeHexColor(advancedSeed.secondary),
      warning: normalizeHexColor(advancedSeed.warning),
      danger: normalizeHexColor(advancedSeed.danger),
    },
  });
};

export const createThemePreviewStyle = (palette: ThemeSlotPalette): Record<string, string> => ({
  '--bg-primary': palette.bgPrimary,
  '--bg-secondary': palette.bgSecondary,
  '--bg-tertiary': palette.bgTertiary,
  '--bg-hover': palette.bgHover,
  '--text-primary': palette.textPrimary,
  '--text-secondary': palette.textSecondary,
  '--text-muted': palette.textMuted,
  '--border-color': palette.borderColor,
  '--accent-color': palette.accentColor,
  '--accent-contrast': palette.accentContrast,
  '--danger-color': palette.dangerColor,
  '--success-color': palette.successColor,
  '--warning-color': palette.warningColor,
});

export const createThemePreviewPalette = (document: Base46ThemeDocument): ThemeSlotPalette =>
  compileBase46ThemeDocument(document);

export const applySimpleThemeSeed = (
  seed: SimpleThemeSeed,
  type: ThemeVariant
): { simple: SimpleThemeSeed; advanced: AdvancedThemeSeed } => ({
  simple: { ...seed },
  advanced: createAdvancedThemeSeedFromSimpleSeed(seed, type),
});

export const buildThemePresetVariant = ({
  label,
  existingPreset,
  type,
  document,
}: {
  label: string;
  existingPreset?: Base46ThemePresetInput;
  type: ThemeVariant;
  document: Base46ThemeDocument;
}): Base46ThemePresetInput => ({
  label,
  light: existingPreset?.light,
  dark: existingPreset?.dark,
  [type]: document,
});
