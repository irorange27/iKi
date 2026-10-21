

export type DevToolsProbeTarget = 'selected' | 'hovered' | 'selector' | 'point';

export type DevToolsElementLocator = {

  selector: string;
  tag: string;

  components: string[];

  ownerFile?: string;

  vFor?: string;

  text?: string;

  box?: [number, number, number, number];
};

export type DevToolsSourceResult = {
  ok: boolean;

  locator?: DevToolsElementLocator;

  mapped?: { source: string; line: number; column: number; name?: string };

  reason?: string;

  windowTitle?: string;
};

export type DevToolsResolveRequest = {
  target?: DevToolsProbeTarget;
  selector?: string;

  point?: [number, number];

  line?: number;
  column?: number;
  scriptUrl?: string;
  webContentsId?: number;
};

export type DevRuntimeStatus = {

  available: boolean;

  hotReload: boolean;
  isPackaged: boolean;
  appVersion: string;
  appPath: string;
};
