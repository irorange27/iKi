/**
 * The app-config document = the settings domain contract + the theme section.
 *
 * Every default used to be declared three times: a literal table here, a
 * per-field `.catch()` mirror, and the hand-written `AppConfig` interface.
 * Now the domain schema (`@iki/core/domain/settings`) declares each default
 * once as a leaf `.catch()` value, `AppConfig` is its `z.infer` projection,
 * and this file only adds what the domain may not know about — `@iki/theme`.
 */
import { z } from 'zod';
import { AppSettingsSchema } from '@iki/core/domain/settings';
import { Base46ThemePresetInputSchema } from '@iki/theme/base46_schema';
import { createDefaultThemeConfig } from '@iki/theme/registry';

const DEFAULT_THEMES = createDefaultThemeConfig();

/** `Base46ThemePresetInput` is the loose input shape; `.catch()` needs the
 *  schema's output — parse once at module init to cross that variance. */
const DEFAULT_BASE46_PRESETS = Object.fromEntries(
  Object.entries(DEFAULT_THEMES.base46Presets).map(([presetId, preset]) => [
    presetId,
    Base46ThemePresetInputSchema.parse(preset),
  ])
);

const ThemesInnerSchema = z.object({
  base46Presets: z
    .record(z.string(), Base46ThemePresetInputSchema)
    .catch(DEFAULT_BASE46_PRESETS),
});

const DEFAULT_THEMES_SECTION = ThemesInnerSchema.parse(DEFAULT_THEMES);

/** A malformed or missing themes section falls back to the theme defaults. */
const ThemesSchema = ThemesInnerSchema.prefault({}).catch(DEFAULT_THEMES_SECTION);

export const AppConfigSchema = AppSettingsSchema.extend({
  themes: ThemesSchema,
}).passthrough();
