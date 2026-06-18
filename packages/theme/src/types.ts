export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeVariant = 'light' | 'dark';

export interface Base46ThemeDocument {
  name: string;
  type: ThemeVariant;
  base_30: Record<string, string>;
  base_16: Record<string, string>;
}

export interface Base46ThemePresetInput {
  label: string;
  light?: Base46ThemeDocument;
  dark?: Base46ThemeDocument;
}

export interface ThemeConfig {
  base46Presets: Record<string, Base46ThemePresetInput>;
}

export interface SimpleThemeSeed {
  background: string;
  text: string;
  accent: string;
  secondary: string;
}

export interface AdvancedThemeSeed extends SimpleThemeSeed {
  surface: string;
  surfaceAlt: string;
  hover: string;
  muted: string;
  warning: string;
  danger: string;
}

export interface ThemeQuickStartDefinition {
  id: string;
  label: string;
  dark: SimpleThemeSeed;
  light: SimpleThemeSeed;
}

export interface ThemeSlotPalette {
  colorScheme: ThemeVariant;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  bgActive: string;
  surfaceInsetHighlight: string;
  surfaceShadowSm: string;
  surfaceShadowMd: string;
  surfaceShadowLg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderColor: string;
  accentColor: string;
  accentHover: string;
  accentContrast: string;
  accentRgb: string;
  referenceInlineColor: string;
  referenceInlineHover: string;
  referenceInlineUnderline: string;
  successColor: string;
  successRgb: string;
  statusSuccessColor: string;
  warningColor: string;
  warningRgb: string;
  dangerColor: string;
  dangerRgb: string;
  statusDangerColor: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  appShellBorderColor: string;
  appShellShadow: string;
  chatComposerBorderColor: string;
  chatComposerBackground: string;
  chatComposerToolbarBackground: string;
  chatComposerToolbarBorderColor: string;
  chatComposerControlBackground: string;
  chatComposerControlBorderColor: string;
  chatComposerControlHoverBackground: string;
  chatComposerControlHoverBorderColor: string;
  chatComposerControlDisabledBackground: string;
  chatComposerControlDisabledBorderColor: string;
  chatComposerSendBackground: string;
  chatComposerSendHoverBackground: string;
  chatComposerSendHoverBorderColor: string;
  chatComposerSendHoverShadow: string;
  chatComposerStopBackground: string;
  chatComposerStopHoverBackground: string;
  chatComposerStopHoverBorderColor: string;
  chatComposerActionForeground: string;
  composerWorkspaceBadgeBackground: string;
  composerWorkspaceBadgeForeground: string;
  sidebarResizeIndicatorColor: string;
  chatComposerBackdropFilter: string;
  chatComposerShadow: string;
  chatUserBubbleBackground: string;
  chatUserBubbleBorderColor: string;
  chatUserBubbleShadow: string;
  chatUserBubbleText: string;
  chatUserBubbleRadius: string;
}

export interface ThemePreset {
  id: string;
  label: string;
  source: 'builtin' | 'base46';
  variants: Partial<Record<ThemeVariant, ThemeSlotPalette>>;
  defaultVariant: ThemeVariant;
}

export interface ThemePresetSummary {
  id: string;
  label: string;
  source: ThemePreset['source'];
  variants: ThemeVariant[];
  defaultVariant: ThemeVariant;
}

export interface ResolvedThemeSelection {
  requestedVariant: ThemeVariant;
  resolvedVariant: ThemeVariant;
  presetId: string;
  presetLabel: string;
  palette: ThemeSlotPalette;
}

export const THEME_SLOT_TO_CSS_VARIABLE = {
  bgPrimary: '--theme-bg-primary',
  bgSecondary: '--theme-bg-secondary',
  bgTertiary: '--theme-bg-tertiary',
  bgHover: '--theme-bg-hover',
  bgActive: '--theme-bg-active',
  surfaceInsetHighlight: '--theme-surface-inset-highlight',
  surfaceShadowSm: '--theme-surface-shadow-sm',
  surfaceShadowMd: '--theme-surface-shadow-md',
  surfaceShadowLg: '--theme-surface-shadow-lg',
  textPrimary: '--theme-text-primary',
  textSecondary: '--theme-text-secondary',
  textMuted: '--theme-text-muted',
  borderColor: '--theme-border-color',
  accentColor: '--theme-accent-color',
  accentHover: '--theme-accent-hover',
  accentContrast: '--theme-accent-contrast',
  accentRgb: '--theme-accent-rgb',
  referenceInlineColor: '--theme-reference-inline-color',
  referenceInlineHover: '--theme-reference-inline-hover',
  referenceInlineUnderline: '--theme-reference-inline-underline',
  successColor: '--theme-success-color',
  successRgb: '--theme-success-rgb',
  statusSuccessColor: '--theme-status-success-color',
  warningColor: '--theme-warning-color',
  warningRgb: '--theme-warning-rgb',
  dangerColor: '--theme-danger-color',
  dangerRgb: '--theme-danger-rgb',
  statusDangerColor: '--theme-status-danger-color',
  chart1: '--theme-chart-1',
  chart2: '--theme-chart-2',
  chart3: '--theme-chart-3',
  chart4: '--theme-chart-4',
  chart5: '--theme-chart-5',
  appShellBorderColor: '--theme-app-shell-border-color',
  appShellShadow: '--theme-app-shell-shadow',
  chatComposerBorderColor: '--theme-chat-composer-border-color',
  chatComposerBackground: '--theme-chat-composer-background',
  chatComposerToolbarBackground: '--theme-chat-composer-toolbar-background',
  chatComposerToolbarBorderColor: '--theme-chat-composer-toolbar-border-color',
  chatComposerControlBackground: '--theme-chat-composer-control-background',
  chatComposerControlBorderColor: '--theme-chat-composer-control-border-color',
  chatComposerControlHoverBackground: '--theme-chat-composer-control-hover-background',
  chatComposerControlHoverBorderColor: '--theme-chat-composer-control-hover-border-color',
  chatComposerControlDisabledBackground: '--theme-chat-composer-control-disabled-background',
  chatComposerControlDisabledBorderColor: '--theme-chat-composer-control-disabled-border-color',
  chatComposerSendBackground: '--theme-chat-composer-send-background',
  chatComposerSendHoverBackground: '--theme-chat-composer-send-hover-background',
  chatComposerSendHoverBorderColor: '--theme-chat-composer-send-hover-border-color',
  chatComposerSendHoverShadow: '--theme-chat-composer-send-hover-shadow',
  chatComposerStopBackground: '--theme-chat-composer-stop-background',
  chatComposerStopHoverBackground: '--theme-chat-composer-stop-hover-background',
  chatComposerStopHoverBorderColor: '--theme-chat-composer-stop-hover-border-color',
  chatComposerActionForeground: '--theme-chat-composer-action-foreground',
  composerWorkspaceBadgeBackground: '--theme-composer-workspace-badge-background',
  composerWorkspaceBadgeForeground: '--theme-composer-workspace-badge-foreground',
  sidebarResizeIndicatorColor: '--theme-sidebar-resize-indicator-color',
  chatComposerBackdropFilter: '--theme-chat-composer-backdrop-filter',
  chatComposerShadow: '--theme-chat-composer-shadow',
  chatUserBubbleBackground: '--theme-chat-user-bubble-background',
  chatUserBubbleBorderColor: '--theme-chat-user-bubble-border-color',
  chatUserBubbleShadow: '--theme-chat-user-bubble-shadow',
  chatUserBubbleText: '--theme-chat-user-bubble-text',
  chatUserBubbleRadius: '--theme-chat-user-bubble-radius',
} as const satisfies Record<Exclude<keyof ThemeSlotPalette, 'colorScheme'>, string>;
