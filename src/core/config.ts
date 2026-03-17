import type { AppConfig } from '../shared/types/config';
import { mergeAppConfig } from '../shared/config/defaults';
import { getConfig, setConfig } from './db/database';
import { getDisplayScale, getLocale, getTheme } from './platform';

// Pure function: detect system and generate dynamic default configuration
function getSystemConfig(): AppConfig {
  const locale = getLocale();
  const scale = getDisplayScale();

  const config = mergeAppConfig();

  // Use larger font for high-scale displays
  config.ui.fontSize = scale > 1.5 ? 16 : 14;
  // Use spacious layout for high-resolution displays
  config.ui.density = scale > 1.25 ? 'spacious' : scale < 1 ? 'compact' : 'comfortable';
  config.general.language = locale || config.general.language;
  config.general.theme = getTheme();
  // Automatically identify OS settings for keybindings
  config.keybindings.openSettings = process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,';

  return config;
}

// Simplified configuration manager (SQLite-backed)
export class ConfigManager {
  async read() {
    const config = getConfig('app_config') as AppConfig | null;
    return config ?? getSystemConfig();
  }

  async write(config: AppConfig) {
    setConfig('app_config', config);
  }
}
