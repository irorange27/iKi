import type { OpenDevToolsOptions, WebContents } from 'electron';

type DevToolsPolicyContext = {
  isPackaged: boolean;
  /** Value of the app config's auto-open toggle; `undefined` means "never set". */
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

/**
 * DevTools auto-open policy:
 *
 *   1. a packaged build NEVER auto-opens — the dock is noise for real users,
 *      and the app ships without developer affordances;
 *   2. in development, `IKI_AUTO_OPEN_DEVTOOLS` wins when it parses (the gate
 *      runs the app with `=false`; hand debugging can force `=true`);
 *   3. otherwise the stored app-config toggle decides, and an unset value
 *      opens DevTools — a fresh checkout behaves like the old dev default.
 *      Set the toggle to `false` for a quiet window. On-demand DevTools
 *      (F12 / Cmd+Shift+I) stays available either way.
 */
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

// ---------------------------------------------------------------------------
// On-demand DevTools
// ---------------------------------------------------------------------------

/**
 * Chrome's DevTools accelerators, identical in development and in a packaged
 * build. They live on the app menu, so they apply to every window (main,
 * settings, companion) without per-window key plumbing, and they keep working
 * after a renderer reload because the menu belongs to the main process.
 */
export const DEVTOOLS_TOGGLE_ACCELERATOR = 'F12';
export const DEVTOOLS_TOGGLE_ACCELERATOR_ALT = 'CommandOrControl+Shift+I';

type ToggleableContents = Pick<
  WebContents,
  'isDestroyed' | 'isDevToolsOpened' | 'openDevTools' | 'closeDevTools' | 'getURL'
> & { readonly devToolsEnabled?: boolean };

const isInternalDevToolsPage = (url: string): boolean =>
  url.startsWith('devtools://') || url.startsWith('chrome-devtools://');

/**
 * Flip DevTools for one window. `openDevTools` is idempotent (an already-open
 * pane just gets focused), so toggling has to close an open pane explicitly.
 * A window created with `webPreferences.devTools: false` cannot host DevTools
 * at all — it is skipped rather than triggering Electron's hard
 * "Cannot open DevTools" error.
 */
export const toggleDevTools = (
  webContents: ToggleableContents,
  options?: OpenDevToolsOptions
): boolean => {
  if (webContents.isDestroyed()) return false;
  if (webContents.devToolsEnabled === false) return false;
  // Chromium refuses DevTools for its own inspector pages.
  if (isInternalDevToolsPage(webContents.getURL())) return false;
  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools();
    return false;
  }
  webContents.openDevTools(options);
  return true;
};

/**
 * Build the action the View menu's toggle runs: flip DevTools on the window
 * currently in front, falling back to the main window. Going through
 * `getFocusedWindow()` inside the click handler (instead of capturing one
 * `webContents` at construction time) keeps the accelerator honest in every
 * window kind, not just the main one.
 */
export const createDevToolsToggleAction =
  (resolveTarget: () => WebContents | null, options?: OpenDevToolsOptions) =>
  (): boolean => {
    const target = resolveTarget();
    if (!target) return false;
    return toggleDevTools(target, options);
  };
