export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const normalizeAppLocale = (value: string | null | undefined): SupportedLocale => {
  if (typeof value !== 'string') return DEFAULT_LOCALE;

  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_LOCALE;

  const normalized = trimmed.replace('_', '-').toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return 'zh-CN';
  }

  return 'en';
};
