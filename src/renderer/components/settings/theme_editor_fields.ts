import type { AdvancedThemeSeed, SimpleThemeSeed } from '../../../shared/theme/types';
import type { TranslationKey } from '../../i18n';

type ThemeFieldDefinition<Key extends string> = {
  key: Key;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
};

export const SIMPLE_THEME_FIELDS = [
  {
    key: 'background',
    labelKey: 'settings.theme.field.background.label',
    hintKey: 'settings.theme.field.background.hint',
  },
  {
    key: 'text',
    labelKey: 'settings.theme.field.text.label',
    hintKey: 'settings.theme.field.text.hint',
  },
  {
    key: 'accent',
    labelKey: 'settings.theme.field.accent.label',
    hintKey: 'settings.theme.field.accent.hint',
  },
  {
    key: 'secondary',
    labelKey: 'settings.theme.field.secondary.label',
    hintKey: 'settings.theme.field.secondary.hint',
  },
] as const satisfies readonly ThemeFieldDefinition<keyof SimpleThemeSeed>[];

export const ADVANCED_THEME_FIELDS = [
  {
    key: 'background',
    labelKey: 'settings.theme.field.background.label',
    hintKey: 'settings.theme.field.background.hint',
  },
  {
    key: 'surface',
    labelKey: 'settings.theme.field.surface.label',
    hintKey: 'settings.theme.field.surface.hint',
  },
  {
    key: 'surfaceAlt',
    labelKey: 'settings.theme.field.surfaceAlt.label',
    hintKey: 'settings.theme.field.surfaceAlt.hint',
  },
  {
    key: 'hover',
    labelKey: 'settings.theme.field.hover.label',
    hintKey: 'settings.theme.field.hover.hint',
  },
  {
    key: 'text',
    labelKey: 'settings.theme.field.text.label',
    hintKey: 'settings.theme.field.text.hint',
  },
  {
    key: 'muted',
    labelKey: 'settings.theme.field.muted.label',
    hintKey: 'settings.theme.field.muted.hint',
  },
  {
    key: 'accent',
    labelKey: 'settings.theme.field.accent.label',
    hintKey: 'settings.theme.field.accent.hint',
  },
  {
    key: 'secondary',
    labelKey: 'settings.theme.field.secondary.label',
    hintKey: 'settings.theme.field.secondary.hint',
  },
  {
    key: 'warning',
    labelKey: 'settings.theme.field.warning.label',
    hintKey: 'settings.theme.field.warning.hint',
  },
  {
    key: 'danger',
    labelKey: 'settings.theme.field.danger.label',
    hintKey: 'settings.theme.field.danger.hint',
  },
] as const satisfies readonly ThemeFieldDefinition<keyof AdvancedThemeSeed>[];
