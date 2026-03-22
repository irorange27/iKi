import type { AdvancedThemeSeed, SimpleThemeSeed } from '../../../shared/theme/types';

type ThemeFieldDefinition<Key extends string> = {
  key: Key;
  label: string;
  hint: string;
};

export const SIMPLE_THEME_FIELDS = [
  {
    key: 'background',
    label: 'Background',
    hint: 'Main background color',
  },
  {
    key: 'text',
    label: 'Text',
    hint: 'Main text color',
  },
  {
    key: 'accent',
    label: 'Accent',
    hint: 'Buttons, links, highlights',
  },
  {
    key: 'secondary',
    label: 'Secondary',
    hint: 'Success states, info',
  },
] as const satisfies readonly ThemeFieldDefinition<keyof SimpleThemeSeed>[];

export const ADVANCED_THEME_FIELDS = [
  {
    key: 'background',
    label: 'Background',
    hint: 'Main background',
  },
  {
    key: 'surface',
    label: 'Surface',
    hint: 'Cards and panels',
  },
  {
    key: 'surfaceAlt',
    label: 'Surface Alt',
    hint: 'Nested chrome',
  },
  {
    key: 'hover',
    label: 'Hover',
    hint: 'Hover or active surfaces',
  },
  {
    key: 'text',
    label: 'Text',
    hint: 'Primary text',
  },
  {
    key: 'muted',
    label: 'Muted',
    hint: 'Secondary text',
  },
  {
    key: 'accent',
    label: 'Accent',
    hint: 'Buttons and links',
  },
  {
    key: 'secondary',
    label: 'Secondary',
    hint: 'Success and info',
  },
  {
    key: 'warning',
    label: 'Warning',
    hint: 'Warnings',
  },
  {
    key: 'danger',
    label: 'Danger',
    hint: 'Destructive actions',
  },
] as const satisfies readonly ThemeFieldDefinition<keyof AdvancedThemeSeed>[];
