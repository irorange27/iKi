import type { AppConfig } from '../types/config';

let _getAppConfig: (() => AppConfig) | null = null;

export function injectGetAppConfig(fn: () => AppConfig) {
  _getAppConfig = fn;
}

export function getAppConfig(): AppConfig {
  if (!_getAppConfig) throw new Error('getAppConfig not injected');
  return _getAppConfig();
}
