import type { OpenDevToolsOptions, WebContents } from 'electron';

type DevToolsPolicyContext = {
  isPackaged: boolean;
  autoOpenEnv?: string;
};

const TRUE_BOOL_ENV = new Set(['1', 'true', 'yes', 'on']);
const FALSE_BOOL_ENV = new Set(['0', 'false', 'no', 'off']);

export const parseBooleanEnv = (value: string | undefined): boolean | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_BOOL_ENV.has(normalized)) return true;
  if (FALSE_BOOL_ENV.has(normalized)) return false;
  return null;
};

export const shouldAutoOpenDevTools = (context: DevToolsPolicyContext): boolean => {
  if (context.isPackaged) return false;
  const parsed = parseBooleanEnv(context.autoOpenEnv);
  return parsed ?? false;
};

export const maybeOpenDevTools = (
  webContents: WebContents,
  context: DevToolsPolicyContext,
  options?: OpenDevToolsOptions
): void => {
  if (!shouldAutoOpenDevTools(context)) return;
  if (webContents.isDestroyed()) return;
  webContents.openDevTools(options);
};
