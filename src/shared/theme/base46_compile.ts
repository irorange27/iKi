import { mixHexColors, readableTextColor, toRgbTuple, withAlpha } from './color_utils';
import type { Base46ThemeDocument, ThemeSlotPalette } from './types';

const FALLBACK_DARK_SHADOW = '#0f172a';
const FALLBACK_LIGHT_SHADOW = '#94a3b8';

export const compileBase46ThemeDocument = (theme: Base46ThemeDocument): ThemeSlotPalette => {
  const ui = theme.base_30;
  const syntax = theme.base_16;
  const isLight = theme.type === 'light';
  const contrastPivot = isLight ? '#111827' : '#ffffff';

  const bgPrimary = ui.black;
  const bgSecondary = ui.darker_black;
  const bgTertiary = ui.one_bg;
  const bgHover = ui.one_bg2;
  const bgActive = ui.one_bg3 ?? mixHexColors(ui.one_bg2, ui.blue, isLight ? 0.08 : 0.14);
  const textPrimary = ui.white;
  const textSecondary = ui.light_grey;
  const textMuted = ui.grey;
  const borderColor = ui.line;
  const accentColor = ui.blue;
  const accentHover = ui.nord_blue ?? mixHexColors(ui.blue, contrastPivot, isLight ? 0.12 : 0.1);
  const accentContrast = readableTextColor(ui.blue);
  const successColor = ui.green;
  const warningColor = ui.yellow;
  const dangerColor = ui.red;
  const referenceInlineColor = mixHexColors(textSecondary, accentColor, 0.38);
  const referenceInlineHover = mixHexColors(
    referenceInlineColor,
    textPrimary,
    isLight ? 0.2 : 0.24
  );

  const statusSuccessColor = mixHexColors(successColor, contrastPivot, isLight ? 0.18 : 0.16);
  const statusDangerColor = mixHexColors(dangerColor, contrastPivot, isLight ? 0.18 : 0.16);

  const appShellBorderColor = isLight ? withAlpha(borderColor, 0.92) : 'transparent';
  const appShellShadow = isLight
    ? `inset 0 1px 0 ${withAlpha('#ffffff', 0.72)}, inset 0 0 0 1px ${withAlpha(borderColor, 0.88)}`
    : 'none';

  const chatComposerBorderColor = isLight
    ? withAlpha(borderColor, 0.96)
    : withAlpha(mixHexColors(textSecondary, borderColor, 0.35), 0.34);
  const chatComposerBackground = isLight
    ? `linear-gradient(180deg, ${withAlpha(bgPrimary, 0.98)} 0%, ${withAlpha(bgSecondary, 0.98)} 100%)`
    : bgPrimary;
  const chatComposerToolbarBackground = isLight ? withAlpha(bgSecondary, 0.94) : bgPrimary;
  const chatComposerToolbarBorderColor = isLight
    ? withAlpha(borderColor, 0.96)
    : withAlpha(textSecondary, 0.24);
  const chatComposerControlBackground = isLight
    ? withAlpha(bgSecondary, 0.96)
    : withAlpha(textPrimary, 0.04);
  const chatComposerControlBorderColor = isLight
    ? withAlpha(borderColor, 0.96)
    : withAlpha(textSecondary, 0.28);
  const chatComposerControlHoverBackground = isLight
    ? withAlpha(bgHover, 0.98)
    : withAlpha(textPrimary, 0.08);
  const chatComposerControlHoverBorderColor = isLight
    ? withAlpha(mixHexColors(borderColor, textSecondary, 0.25), 0.98)
    : withAlpha(textSecondary, 0.38);
  const chatComposerControlDisabledBackground = isLight
    ? withAlpha(bgPrimary, 0.98)
    : withAlpha(textPrimary, 0.03);
  const chatComposerControlDisabledBorderColor = isLight
    ? withAlpha(bgHover, 0.98)
    : withAlpha(textSecondary, 0.18);

  const chatComposerSendBackground = withAlpha(accentColor, 0.14);
  const chatComposerSendHoverBackground = withAlpha(accentColor, 0.22);
  const chatComposerSendHoverBorderColor = withAlpha(accentColor, 0.3);
  const chatComposerSendHoverShadow = `inset 0 0 0 1px ${withAlpha(accentColor, 0.14)}`;
  const chatComposerStopBackground = withAlpha(dangerColor, 0.18);
  const chatComposerStopHoverBackground = withAlpha(dangerColor, 0.28);
  const chatComposerStopHoverBorderColor = withAlpha(dangerColor, 0.34);
  const chatComposerActionForeground = accentContrast;
  const composerWorkspaceBadgeBackground = accentColor;
  const composerWorkspaceBadgeForeground = accentContrast;
  const sidebarResizeIndicatorColor = withAlpha(textSecondary, 0.5);
  const chatComposerBackdropFilter = isLight ? 'none' : 'blur(18px)';
  const chatComposerShadow = isLight
    ? `0 0 0 1px ${withAlpha(bgHover, 0.65)}, 0 10px 24px ${withAlpha(FALLBACK_LIGHT_SHADOW, 0.1)}, inset 0 1px 0 ${withAlpha('#ffffff', 0.75)}`
    : `0 18px 36px ${withAlpha('#000000', 0.24)}, inset 0 1px 0 ${withAlpha('#ffffff', 0.03)}`;

  const lightBubbleStart = mixHexColors(accentColor, bgPrimary, 0.24);
  const lightBubbleEnd = mixHexColors(accentColor, bgSecondary, 0.32);
  const darkBubble = mixHexColors(bgPrimary, bgHover, 0.36);
  const chatUserBubbleBackground = isLight
    ? `linear-gradient(180deg, ${lightBubbleStart} 0%, ${lightBubbleEnd} 100%)`
    : darkBubble;
  const chatUserBubbleBorderColor = isLight
    ? withAlpha(mixHexColors(accentColor, borderColor, 0.35), 0.32)
    : withAlpha(mixHexColors(bgTertiary, borderColor, 0.45), 0.22);
  const chatUserBubbleShadow = isLight
    ? `0 12px 22px ${withAlpha(mixHexColors(accentColor, bgSecondary, 0.6), 0.18)}`
    : `0 10px 22px ${withAlpha(mixHexColors(bgPrimary, FALLBACK_DARK_SHADOW, 0.75), 0.24)}`;
  const chatUserBubbleText = isLight ? accentContrast : textPrimary;
  const chatUserBubbleRadius = isLight ? '28px' : '28px 10px 28px 28px';

  return {
    colorScheme: theme.type,
    bgPrimary,
    bgSecondary,
    bgTertiary,
    bgHover,
    bgActive,
    textPrimary,
    textSecondary,
    textMuted,
    borderColor,
    accentColor,
    accentHover,
    accentContrast,
    accentRgb: toRgbTuple(accentColor),
    referenceInlineColor,
    referenceInlineHover,
    referenceInlineUnderline: withAlpha(referenceInlineColor, isLight ? 0.42 : 0.45),
    successColor,
    successRgb: toRgbTuple(successColor),
    statusSuccessColor,
    warningColor,
    warningRgb: toRgbTuple(warningColor),
    dangerColor,
    dangerRgb: toRgbTuple(dangerColor),
    statusDangerColor,
    chart1: syntax.base0D,
    chart2: syntax.base0B,
    chart3: syntax.base0A,
    chart4: syntax.base0E,
    chart5: syntax.base09,
    appShellBorderColor,
    appShellShadow,
    chatComposerBorderColor,
    chatComposerBackground,
    chatComposerToolbarBackground,
    chatComposerToolbarBorderColor,
    chatComposerControlBackground,
    chatComposerControlBorderColor,
    chatComposerControlHoverBackground,
    chatComposerControlHoverBorderColor,
    chatComposerControlDisabledBackground,
    chatComposerControlDisabledBorderColor,
    chatComposerSendBackground,
    chatComposerSendHoverBackground,
    chatComposerSendHoverBorderColor,
    chatComposerSendHoverShadow,
    chatComposerStopBackground,
    chatComposerStopHoverBackground,
    chatComposerStopHoverBorderColor,
    chatComposerActionForeground,
    composerWorkspaceBadgeBackground,
    composerWorkspaceBadgeForeground,
    sidebarResizeIndicatorColor,
    chatComposerBackdropFilter,
    chatComposerShadow,
    chatUserBubbleBackground,
    chatUserBubbleBorderColor,
    chatUserBubbleShadow,
    chatUserBubbleText,
    chatUserBubbleRadius,
  };
};
