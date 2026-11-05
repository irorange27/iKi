/**
 * Defaults are derived from the schema — there is no literal table to drift.
 * `AppConfigSchema.parse({})` is the default document: every leaf declares its
 * own `.catch()` fallback, so a missing or malformed value resolves to the
 * same place the mirror table used to hard-code.
 */
import type { AppConfig } from '@iki/core/types/config';
import { isObjectRecord } from '@iki/core/utils/guards';
import { toPlainData as clonePlainData } from '@iki/core/utils/plain_clone';
import { AppConfigSchema } from './schema';

export const DEFAULT_APP_CONFIG = AppConfigSchema.parse({}) as AppConfig;

export const createDefaultAppConfig = (): AppConfig => clonePlainData(DEFAULT_APP_CONFIG);

/** Structural merge of a stored partial over a base document. */
const deepMerge = (
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = out[key];
    out[key] = isObjectRecord(value) && isObjectRecord(existing) ? deepMerge(existing, value) : value;
  }
  return out;
};

/**
 * `base` is the system-adapted config (display scale, OS locale, platform
 * keybindings); stored values overlay it before the schema repairs types.
 */
export const mergeAppConfigWithBase = (
  base: AppConfig,
  rawConfig?: Partial<AppConfig> | null
): AppConfig =>
  rawConfig
    ? (deepMerge(
        base as unknown as Record<string, unknown>,
        rawConfig as Record<string, unknown>
      ) as unknown as AppConfig)
    : base;

export const mergeAppConfig = (rawConfig?: Partial<AppConfig> | null): AppConfig =>
  mergeAppConfigWithBase(createDefaultAppConfig(), rawConfig);
