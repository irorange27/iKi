import type {
  Base46ThemePresetInput,
  ThemeConfig,
  ThemePreset,
  ThemeQuickStartDefinition,
  ThemeSlotPalette,
} from './types';
import { cloneBase46ThemePresetInput, createBase46ThemePresetFromQuickStart } from './theme_creator';

export const DEFAULT_THEME_PRESET_ID = 'iki-default';

const BUILTIN_DARK_THEME: ThemeSlotPalette = {
  colorScheme: 'dark',
  bgPrimary: '#2a2d35',
  bgSecondary: '#22272c',
  bgTertiary: '#2e3036',
  bgHover: '#3a3d45',
  bgActive: '#4e5256',
  textPrimary: '#ffffff',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  borderColor: '#4e5256',
  accentColor: '#61afef',
  accentHover: '#5ba2dc',
  accentContrast: '#ffffff',
  accentRgb: '96, 165, 250',
  referenceInlineColor: '#8eabc4',
  referenceInlineHover: '#b4c9db',
  referenceInlineUnderline: 'rgba(142, 171, 196, 0.45)',
  successColor: '#10b981',
  successRgb: '16, 185, 129',
  statusSuccessColor: '#34d399',
  warningColor: '#f59e0b',
  warningRgb: '245, 158, 11',
  dangerColor: '#ef4444',
  dangerRgb: '239, 68, 68',
  statusDangerColor: '#f87171',
  chart1: 'oklch(65.67% 0.0439 209.79)',
  chart2: 'oklch(0.696 0.17 162.48)',
  chart3: 'oklch(0.769 0.188 70.08)',
  chart4: 'oklch(0.627 0.265 303.9)',
  chart5: 'oklch(0.645 0.246 16.439)',
  appShellBorderColor: 'transparent',
  appShellShadow: 'none',
  chatComposerBorderColor: 'rgba(112, 119, 138, 0.34)',
  chatComposerBackground: '#2a2d35',
  chatComposerToolbarBackground: '#2a2d35',
  chatComposerToolbarBorderColor: 'rgba(112, 119, 138, 0.24)',
  chatComposerControlBackground: 'rgba(255, 255, 255, 0.04)',
  chatComposerControlBorderColor: 'rgba(112, 119, 138, 0.28)',
  chatComposerControlHoverBackground: 'rgba(255, 255, 255, 0.08)',
  chatComposerControlHoverBorderColor: 'rgba(152, 160, 180, 0.38)',
  chatComposerControlDisabledBackground: 'rgba(255, 255, 255, 0.03)',
  chatComposerControlDisabledBorderColor: 'rgba(112, 119, 138, 0.18)',
  chatComposerSendBackground: 'rgba(96, 165, 250, 0.14)',
  chatComposerSendHoverBackground: 'rgba(96, 165, 250, 0.22)',
  chatComposerSendHoverBorderColor: 'rgba(96, 165, 250, 0.3)',
  chatComposerSendHoverShadow: 'inset 0 0 0 1px rgba(96, 165, 250, 0.14)',
  chatComposerStopBackground: 'rgba(239, 68, 68, 0.18)',
  chatComposerStopHoverBackground: 'rgba(239, 68, 68, 0.28)',
  chatComposerStopHoverBorderColor: 'rgba(239, 68, 68, 0.34)',
  chatComposerActionForeground: '#ffffff',
  composerWorkspaceBadgeBackground: '#4a9eff',
  composerWorkspaceBadgeForeground: '#ffffff',
  sidebarResizeIndicatorColor: 'rgba(156, 163, 175, 0.5)',
  chatComposerBackdropFilter: 'blur(18px)',
  chatComposerShadow: '0 18px 36px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
  chatUserBubbleBackground: '#2f3643',
  chatUserBubbleBorderColor: 'rgba(47, 54, 67, 0.22)',
  chatUserBubbleShadow: '0 10px 22px rgba(15, 23, 42, 0.24)',
  chatUserBubbleText: '#f8fbff',
  chatUserBubbleRadius: '28px 10px 28px 28px',
};

const BUILTIN_LIGHT_THEME: ThemeSlotPalette = {
  colorScheme: 'light',
  bgPrimary: '#ffffff',
  bgSecondary: '#f3f4f6',
  bgTertiary: '#ffffff',
  bgHover: '#e5e7eb',
  bgActive: '#dbeafe',
  textPrimary: '#111827',
  textSecondary: '#4b5563',
  textMuted: '#9ca3af',
  borderColor: '#e5e7eb',
  accentColor: '#7299a0',
  accentHover: '#81a4aa',
  accentContrast: '#ffffff',
  accentRgb: '59, 130, 246',
  referenceInlineColor: '#7f98aa',
  referenceInlineHover: '#668397',
  referenceInlineUnderline: 'rgba(127, 152, 170, 0.42)',
  successColor: '#10b981',
  successRgb: '16, 185, 129',
  statusSuccessColor: '#34d399',
  warningColor: '#b45309',
  warningRgb: '180, 83, 9',
  dangerColor: '#ef4444',
  dangerRgb: '239, 68, 68',
  statusDangerColor: '#f87171',
  chart1: 'oklch(0.646 0.222 41.116)',
  chart2: 'oklch(0.6 0.118 184.704)',
  chart3: 'oklch(0.398 0.07 227.392)',
  chart4: 'oklch(0.828 0.189 84.429)',
  chart5: 'oklch(0.769 0.188 70.08)',
  appShellBorderColor: 'rgba(203, 213, 225, 0.92)',
  appShellShadow:
    'inset 0 1px 0 rgba(255, 255, 255, 0.72), inset 0 0 0 1px rgba(203, 213, 225, 0.88)',
  chatComposerBorderColor: 'rgba(212, 220, 229, 0.96)',
  chatComposerBackground:
    'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%)',
  chatComposerToolbarBackground: 'rgba(244, 247, 251, 0.94)',
  chatComposerToolbarBorderColor: 'rgba(223, 229, 238, 0.96)',
  chatComposerControlBackground: 'rgba(241, 245, 249, 0.96)',
  chatComposerControlBorderColor: 'rgba(203, 213, 225, 0.96)',
  chatComposerControlHoverBackground: 'rgba(226, 232, 240, 0.98)',
  chatComposerControlHoverBorderColor: 'rgba(184, 198, 214, 0.98)',
  chatComposerControlDisabledBackground: 'rgba(248, 250, 252, 0.98)',
  chatComposerControlDisabledBorderColor: 'rgba(226, 232, 240, 0.98)',
  chatComposerSendBackground: 'rgba(96, 165, 250, 0.14)',
  chatComposerSendHoverBackground: 'rgba(96, 165, 250, 0.22)',
  chatComposerSendHoverBorderColor: 'rgba(59, 130, 246, 0.3)',
  chatComposerSendHoverShadow: 'inset 0 0 0 1px rgba(59, 130, 246, 0.14)',
  chatComposerStopBackground: 'rgba(239, 68, 68, 0.18)',
  chatComposerStopHoverBackground: 'rgba(239, 68, 68, 0.28)',
  chatComposerStopHoverBorderColor: 'rgba(239, 68, 68, 0.34)',
  chatComposerActionForeground: '#ffffff',
  composerWorkspaceBadgeBackground: '#4a9eff',
  composerWorkspaceBadgeForeground: '#ffffff',
  sidebarResizeIndicatorColor: 'rgba(156, 163, 175, 0.5)',
  chatComposerBackdropFilter: 'none',
  chatComposerShadow:
    '0 0 0 1px rgba(226, 232, 240, 0.65), 0 10px 24px rgba(148, 163, 184, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.75)',
  chatUserBubbleBackground: 'linear-gradient(180deg, #7ea7b1 0%, #769eaa 100%)',
  chatUserBubbleBorderColor: 'rgba(106, 146, 156, 0.32)',
  chatUserBubbleShadow: '0 12px 22px rgba(125, 166, 176, 0.18)',
  chatUserBubbleText: '#ffffff',
  chatUserBubbleRadius: '28px 10px 28px 28px',
};

export const BUILTIN_THEME_PRESET: ThemePreset = {
  id: DEFAULT_THEME_PRESET_ID,
  label: 'iKi Default',
  source: 'builtin',
  defaultVariant: 'dark',
  variants: {
    dark: BUILTIN_DARK_THEME,
    light: BUILTIN_LIGHT_THEME,
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
