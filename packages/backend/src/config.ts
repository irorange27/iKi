import type { AppConfig } from './types/config';
import { createDefaultAppConfig } from './config/defaults';
import { normalizeAppConfig } from './config/normalize';
import { normalizeAppLocale } from '@iki/backend/i18n/locale';
import { getConfig, setConfig } from './db/database';
import { getDisplayScale, getLocale, getTheme } from './platform';

function getSystemConfig(): AppConfig {
  const locale = getLocale();
  const scale = getDisplayScale();

  const config = createDefaultAppConfig();

  config.ui.fontSize = scale > 1.5 ? 16 : 14;

  config.ui.density = scale > 1.25 ? 'spacious' : scale < 1 ? 'compact' : 'comfortable';
  config.general.language = normalizeAppLocale(locale);
  config.general.theme = getTheme();

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
