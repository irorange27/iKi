import type { SupportedLocale } from '@iki/core/i18n/locale';
import { en } from './catalogs/en';
import { zhCN } from './catalogs/zh-CN';
import type { LocaleCatalog } from './shared';

export type { TranslationEntry, TranslationParams } from './shared';

export type TranslationKey = keyof typeof en;
export type MessageCatalog = LocaleCatalog<typeof en>;

export const messages = {
  en,
  'zh-CN': zhCN,
} satisfies Record<SupportedLocale, MessageCatalog>;
