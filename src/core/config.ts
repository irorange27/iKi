import type { AppConfig } from '../shared/types/config';
import { createDefaultAppConfig } from '../shared/config/defaults';
import { normalizeAppConfig } from '../shared/config/normalize';
import { normalizeAppLocale } from '../shared/i18n/locale';
import { getConfig, setConfig } from './db/database';
import { getDisplayScale, getLocale, getTheme } from './platform';

// Pure function: detect system and generate dynamic default configuration
function getSystemConfig(): AppConfig {
  const locale = getLocale();
  const scale = getDisplayScale();

  const config = createDefaultAppConfig();

  // Use larger font for high-scale displays
  config.ui.fontSize = scale > 1.5 ? 16 : 14;
  // Use spacious layout for high-resolution displays
  config.ui.density = scale > 1.25 ? 'spacious' : scale < 1 ? 'compact' : 'comfortable';
  config.general.language = normalizeAppLocale(locale);
  config.general.theme = getTheme();
  // Automatically identify OS settings for keybindings
  config.keybindings.openSettings = process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,';

  return config;
}

export const getAppConfig = (): AppConfig => {
  const stored = getConfig('app_config') as Partial<AppConfig> | null;
  return normalizeAppConfig(stored, getSystemConfig());
};

export const setAppConfig = (config: AppConfig): void => {
  setConfig('app_config', normalizeAppConfig(config));
};
