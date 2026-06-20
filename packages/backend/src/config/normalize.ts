import type { AppConfig } from '../types/config';
import { isObjectRecord } from '@iki/core/utils/guards';
import { mergeAppConfig, mergeAppConfigWithBase } from './defaults';
import { AppConfigSchema } from './schema';

export const normalizeAppConfig = (raw: unknown, base?: AppConfig): AppConfig => {
  const partial = isObjectRecord(raw) ? (raw as Partial<AppConfig>) : null;
  const merged = base ? mergeAppConfigWithBase(base, partial) : mergeAppConfig(partial);
  return AppConfigSchema.parse(merged) as AppConfig;
};
