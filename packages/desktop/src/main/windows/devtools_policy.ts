import type { OpenDevToolsOptions, WebContents } from 'electron';

type DevToolsPolicyContext = {
  isPackaged: boolean;
  
  autoOpenConfig?: boolean;
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
  const fromEnv = parseBooleanEnv(context.autoOpenEnv);
  if (fromEnv !== null) return fromEnv;
  return context.autoOpenConfig ?? true;
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

export const DEVTOOLS_TOGGLE_ACCELERATOR = 'F12';
export const DEVTOOLS_TOGGLE_ACCELERATOR_ALT = 'CommandOrControl+Shift+I';

type ToggleableContents = Pick<
  WebContents,
  'isDestroyed' | 'isDevToolsOpened' | 'openDevTools' | 'closeDevTools' | 'getURL'
> & { readonly devToolsEnabled?: boolean };

const isInternalDevToolsPage = (url: string): boolean =>
  url.startsWith('devtools://') || url.startsWith('chrome-devtools://');

export const toggleDevTools = (
  webContents: ToggleableContents,
  options?: OpenDevToolsOptions
): boolean => {
  if (webContents.isDestroyed()) return false;
  if (webContents.devToolsEnabled === false) return false;
  if (isInternalDevToolsPage(webContents.getURL())) return false;
  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools();
    return false;
  }
  webContents.openDevTools(options);
  return true;
};

export const createDevToolsToggleAction =
  (resolveTarget: () => WebContents | null, options?: OpenDevToolsOptions) =>
  (): boolean => {
    const target = resolveTarget();
    if (!target) return false;
    return toggleDevTools(target, options);
  };
