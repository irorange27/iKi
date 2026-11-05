import type { ThemeConfig } from '@iki/theme/types';
import type { AppSettings } from '../domain/settings';

export interface ConfigRuntimeInfo {
  userDataPath: string;
  storePath: string;
}

export type NetworkDiagnosticTargetKey = 'internet' | 'searchEngine';

export interface NetworkDiagnosticProbeResult {
  key: NetworkDiagnosticTargetKey;
  url: string;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  resolvedProxy: string | null;
}

export interface NetworkDiagnosticResult {
  success: boolean;
  testedAt: string;
  effectiveProxy: string | null;
  error: string | null;
  results: NetworkDiagnosticProbeResult[];
}

export type WebSearchEngine = 'google' | 'duckduckgo' | 'bing';

/**
 * The app configuration is the settings domain contract (`../domain/settings`,
 * where every default is declared exactly once in the schema) plus the theme
 * section, which belongs to `@iki/theme`. The hand-written per-section
 * interfaces and their `.catch()` mirror in the old `backend/config/schema.ts`
 * are deleted — one schema, one projection.
 */
export interface AppConfig extends AppSettings {
  themes: ThemeConfig;
}
