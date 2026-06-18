import { nativeTheme } from 'electron';

import { getAppConfig } from '@iki/core/config';
import { resolveThemeSelection } from '@iki/theme/registry';

export const resolveWindowBootstrapBackgroundColor = (): string => {
  const config = getAppConfig();
  return resolveThemeSelection({
    presetId: config.general.themePresetId,
    themeMode: config.general.theme,
    systemPrefersDark: nativeTheme.shouldUseDarkColors,
    base46Presets: config.themes.base46Presets,
  }).palette.bgPrimary;
};
