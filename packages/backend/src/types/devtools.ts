/**
 * Element → source contract shared by the desktop main process and the model
 * tool. Everything here crosses IPC, so it stays plain data.
 */

export type DevToolsProbeTarget = 'selected' | 'hovered' | 'selector' | 'point';

export type DevToolsElementLocator = {
  /** CSS path from `document.body`, usable in a selector probe or the CDP API. */
  selector: string;
  tag: string;
  /** Vue component chain, innermost first (`__file` values). */
  components: string[];
  /** The component whose template renders this element. */
  ownerFile?: string;
  /** Best-effort `v-for` collection name, for list rows. */
  vFor?: string;
  /** Trimmed text content, truncated — a hint for grepping the template. */
  text?: string;
  /** Viewport box: top, left, bottom, right. */
  box?: [number, number, number, number];
};

export type DevToolsSourceResult = {
  ok: boolean;
  /** `selector` in the probe, `webContentsId` for multi-window apps. */
  locator?: DevToolsElementLocator;
  /** Present only when a bundled position was mapped through a sourcemap. */
  mapped?: { source: string; line: number; column: number; name?: string };
  /** Human-facing explanation when `ok` is false. */
  reason?: string;
  /** Window the probe ran against. */
  windowTitle?: string;
};

export type DevToolsResolveRequest = {
  target?: DevToolsProbeTarget;
  selector?: string;
  /** Viewport `[x, y]` for `target: "point"` — no click or hover required. */
  point?: [number, number];
  /** Bundled position from CDP's `DOM.getNodeForLocation`, if the caller measured one. */
  line?: number;
  column?: number;
  scriptUrl?: string;
  webContentsId?: number;
};

/**
 * Development-runtime facts the renderer needs to offer "change my own code"
 * actions (restart for main-process edits, hot reload for renderer edits).
 */
export type DevRuntimeStatus = {
  /** False in the packaged app: no restart action, no sourcemaps on disk. */
  available: boolean;
  /** True when the renderer is served by Vite with HMR, i.e. edits hot-reload. */
  hotReload: boolean;
  isPackaged: boolean;
  appVersion: string;
  appPath: string;
};
