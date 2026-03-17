import os from 'node:os';
import path from 'node:path';

export type PlatformTheme = 'light' | 'dark';

export type PlatformInfo = {
  userDataPath?: string;
  locale?: string;
  theme?: PlatformTheme;
  displayScale?: number;
};

let platformInfo: PlatformInfo = {};

const normalizeLocale = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.split('-')[0] || trimmed;
};

export const setPlatformInfo = (info: PlatformInfo) => {
  platformInfo = {
    ...platformInfo,
    ...info,
  };
};

export const getPlatformInfo = (): PlatformInfo => ({ ...platformInfo });

export const getUserDataPath = (): string => {
  if (platformInfo.userDataPath && platformInfo.userDataPath.trim()) {
    return platformInfo.userDataPath.trim();
  }
  const envPath = process.env.IKI_USER_DATA_PATH;
  if (typeof envPath === 'string' && envPath.trim()) return envPath.trim();
  return path.join(os.homedir(), '.iki');
};

export const getLocale = (): string => {
  const fromInfo = normalizeLocale(platformInfo.locale);
  if (fromInfo) return fromInfo;
  const resolved = normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  if (resolved) return resolved;
  return 'en';
};

export const getTheme = (): PlatformTheme => {
  if (platformInfo.theme === 'dark' || platformInfo.theme === 'light') {
    return platformInfo.theme;
  }
  const envTheme = process.env.IKI_THEME;
  if (envTheme === 'dark') return 'dark';
  return 'light';
};

export const getDisplayScale = (): number => {
  if (typeof platformInfo.displayScale === 'number' && Number.isFinite(platformInfo.displayScale)) {
    return platformInfo.displayScale;
  }
  const envScale = Number(process.env.IKI_DISPLAY_SCALE);
  if (Number.isFinite(envScale) && envScale > 0) return envScale;
  return 1;
};
