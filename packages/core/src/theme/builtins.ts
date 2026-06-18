import type {
  Base46ThemeDocument,
  Base46ThemePresetInput,
  ThemeConfig,
  ThemePreset,
  ThemeQuickStartDefinition,
} from './types';
import { compileBase46ThemeDocument } from './base46_compile';
import { parseBase46ThemePresetInput } from './base46_schema';
import { cloneBase46ThemePresetInput, createBase46ThemePresetFromQuickStart } from './theme_creator';

export const DEFAULT_THEME_PRESET_ID = 'iki-default';

const buildBase16Palette = ({
  background,
  secondaryBackground,
  surface,
  hover,
  muted,
  secondaryText,
  primaryText,
  danger,
  chart5,
  chart3,
  chart2,
  chart4,
  chart1,
}: {
  background: string;
  secondaryBackground: string;
  surface: string;
  hover: string;
  muted: string;
  secondaryText: string;
  primaryText: string;
  danger: string;
  chart5: string;
  chart3: string;
  chart2: string;
  chart4: string;
  chart1: string;
}): Base46ThemeDocument['base_16'] => ({
  base00: background,
  base01: secondaryBackground,
  base02: surface,
  base03: hover,
  base04: muted,
  base05: secondaryText,
  base06: secondaryText,
  base07: primaryText,
  base08: danger,
  base09: chart5,
  base0A: chart3,
  base0B: chart2,
  base0C: chart2,
  base0D: chart1,
  base0E: chart4,
  base0F: danger,
});

export const BUILTIN_BASE46_DEFAULT_PRESET: Base46ThemePresetInput = parseBase46ThemePresetInput({
  label: 'iKi Default',
  dark: {
    name: 'iKi Default Dark',
    type: 'dark',
    base_30: {
      white: '#ffffff',
      black: '#2a2d35',
      darker_black: '#22272c',
      one_bg: '#2e3036',
      one_bg2: '#3a3d45',
      one_bg3: '#4e5256',
      grey: '#6b7280',
      light_grey: '#9ca3af',
      line: '#4e5256',
      red: '#ef4444',
      green: '#10b981',
      blue: '#61afef',
      nord_blue: '#5ba2dc',
      yellow: '#f59e0b',
    },
    base_16: buildBase16Palette({
      background: '#2a2d35',
      secondaryBackground: '#22272c',
      surface: '#2e3036',
      hover: '#3a3d45',
      muted: '#6b7280',
      secondaryText: '#9ca3af',
      primaryText: '#ffffff',
      danger: '#ef4444',
      chart5: '#fb7185',
      chart3: '#fbbf24',
      chart2: '#34d399',
      chart4: '#c084fc',
      chart1: '#7aa2b1',
    }),
  },
  light: {
    name: 'iKi Default Light',
    type: 'light',
    base_30: {
      white: '#111827',
      black: '#ffffff',
      darker_black: '#f3f4f6',
      one_bg: '#ffffff',
      one_bg2: '#e5e7eb',
      one_bg3: '#dbeafe',
      grey: '#9ca3af',
      light_grey: '#4b5563',
      line: '#e5e7eb',
      red: '#ef4444',
      green: '#10b981',
      blue: '#7299a0',
      nord_blue: '#81a4aa',
      yellow: '#b45309',
    },
    base_16: buildBase16Palette({
      background: '#ffffff',
      secondaryBackground: '#f3f4f6',
      surface: '#ffffff',
      hover: '#e5e7eb',
      muted: '#9ca3af',
      secondaryText: '#4b5563',
      primaryText: '#111827',
      danger: '#ef4444',
      chart5: '#f59e0b',
      chart3: '#4f6b97',
      chart2: '#14b8a6',
      chart4: '#facc15',
      chart1: '#f97316',
    }),
  },
});

export const BUILTIN_THEME_PRESET: ThemePreset = {
  id: DEFAULT_THEME_PRESET_ID,
  label: BUILTIN_BASE46_DEFAULT_PRESET.label,
  source: 'builtin',
  defaultVariant: 'dark',
  variants: {
    dark: BUILTIN_BASE46_DEFAULT_PRESET.dark
      ? compileBase46ThemeDocument(BUILTIN_BASE46_DEFAULT_PRESET.dark)
      : undefined,
    light: BUILTIN_BASE46_DEFAULT_PRESET.light
      ? compileBase46ThemeDocument(BUILTIN_BASE46_DEFAULT_PRESET.light)
      : undefined,
  },
};

export const THEME_QUICK_STARTS: ThemeQuickStartDefinition[] = [
  {
    id: 'ocean',
    label: 'Ocean',
    dark: {
      background: '#1a1b26',
      text: '#c0caf5',
      accent: '#7aa2f7',
      secondary: '#9ece6a',
    },
    light: {
      background: '#f6f9ff',
      text: '#1f2a44',
      accent: '#4f7cff',
      secondary: '#5eae77',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    dark: {
      background: '#15241f',
      text: '#d8f3dc',
      accent: '#95d5b2',
      secondary: '#74c69d',
    },
    light: {
      background: '#f5fbf6',
      text: '#1b4332',
      accent: '#40916c',
      secondary: '#74c69d',
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    dark: {
      background: '#211f2f',
      text: '#fde2e4',
      accent: '#f28482',
      secondary: '#f6bd60',
    },
    light: {
      background: '#fff8f5',
      text: '#582f0e',
      accent: '#e76f51',
      secondary: '#f4a261',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    dark: {
      background: '#2e3440',
      text: '#d8dee9',
      accent: '#88c0d0',
      secondary: '#a3be8c',
    },
    light: {
      background: '#f4f7fb',
      text: '#2e3440',
      accent: '#5e81ac',
      secondary: '#81a1c1',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    dark: {
      background: '#1e1f1c',
      text: '#f8f8f2',
      accent: '#66d9ef',
      secondary: '#a6e22e',
    },
    light: {
      background: '#fffef7',
      text: '#272822',
      accent: '#3f88c5',
      secondary: '#7cb518',
    },
  },
];

const BUILTIN_GALLERY_THEME_DEFINITIONS = [
  { id: 'aquarium', quickStartId: 'ocean', label: 'Aquarium' },
  { id: 'ashes', quickStartId: 'sunset', label: 'Ashes' },
  { id: 'ayu', quickStartId: 'monokai', label: 'Ayu' },
  { id: 'nord', quickStartId: 'nord', label: 'Nord' },
  { id: 'forest', quickStartId: 'forest', label: 'Forest' },
] as const;

const quickStartMap = new Map(THEME_QUICK_STARTS.map(definition => [definition.id, definition]));

export const BUILTIN_BASE46_GALLERY_PRESETS: Record<string, Base46ThemePresetInput> =
  Object.fromEntries(
    BUILTIN_GALLERY_THEME_DEFINITIONS.map(definition => {
      const quickStart = quickStartMap.get(definition.quickStartId);
      if (!quickStart) {
        throw new Error(`Missing quick start definition: ${definition.quickStartId}`);
      }
      return [
        definition.id,
        {
          ...createBase46ThemePresetFromQuickStart({
            ...quickStart,
            label: definition.label,
          }),
        },
      ];
    })
  );

export const BUILTIN_BASE46_GALLERY_IDS = Object.keys(BUILTIN_BASE46_GALLERY_PRESETS);

export const createDefaultThemeConfig = (): ThemeConfig => ({
  base46Presets: {},
});

export const cloneThemeConfig = (config: ThemeConfig): ThemeConfig => ({
  base46Presets: Object.fromEntries(
    Object.entries(config.base46Presets).map(([id, preset]) => [id, cloneBase46ThemePresetInput(preset)])
  ),
});
