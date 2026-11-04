import { defineLocaleCatalog } from '../shared';
import type { en } from './en';
import { common } from './zh-CN/common';
import { chat } from './zh-CN/chat';
import { settings } from './zh-CN/settings';
import { settingsProviders } from './zh-CN/settings_providers';

export const zhCN = defineLocaleCatalog<typeof en>({
  ...common,
  ...chat,
  ...settings,
  ...settingsProviders,
});
