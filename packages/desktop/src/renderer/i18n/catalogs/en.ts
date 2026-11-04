import { defineCatalog } from '../shared';
import { common } from './en/common';
import { chat } from './en/chat';
import { settings } from './en/settings';
import { settingsProviders } from './en/settings_providers';

export const en = defineCatalog({
  ...common,
  ...chat,
  ...settings,
  ...settingsProviders,
});
