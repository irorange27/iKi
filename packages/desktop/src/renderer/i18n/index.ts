import { computed, ref } from 'vue';
import { DEFAULT_LOCALE, normalizeAppLocale, type SupportedLocale } from '@iki/backend/i18n/locale';
import { messages, type TranslationKey, type TranslationParams } from './messages';

export type { TranslationKey } from './messages';

const currentLocale = ref<SupportedLocale>(DEFAULT_LOCALE);

const interpolate = (template: string, params?: TranslationParams): string => {
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === null || value === undefined ? '' : String(value);
  });
};

const resolveEntry = (
  locale: SupportedLocale,
  key: TranslationKey
): ((params?: TranslationParams) => string) => {
  const entry = messages[locale][key] ?? messages.en[key] ?? key;
  return params => (typeof entry === 'function' ? entry(params ?? {}) : interpolate(entry, params));
};

export const translateWithLocale = (
  locale: string | null | undefined,
  key: TranslationKey,
  params?: TranslationParams
): string => {
  const normalized = normalizeAppLocale(locale);
  return resolveEntry(normalized, key)(params);
};

export const translate = (key: TranslationKey, params?: TranslationParams): string =>
  resolveEntry(currentLocale.value, key)(params);

export const getCurrentLocale = (): SupportedLocale => currentLocale.value;

export const setLocale = (locale: string | null | undefined): SupportedLocale => {
  const normalized = normalizeAppLocale(locale);
  currentLocale.value = normalized;
  return normalized;
};

export const useI18n = () => ({
  locale: computed(() => currentLocale.value),
  t: translate,
});
