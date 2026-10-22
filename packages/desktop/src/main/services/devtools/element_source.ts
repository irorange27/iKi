
import { BrowserWindow, app, webContents as webContentsRegistry } from 'electron';
import path from 'node:path';

import { createLogger } from '@iki/backend/logger';
import type { DevToolsResolveRequest, DevToolsSourceResult } from '@iki/backend/types/devtools';

import {
  buildInstallRecorderExpression,
  buildProbeExpression,
  buildScriptUrlExpression,
} from './source_locator';
import { mapBundledPosition } from './source_maps';
import { readSourceMap } from './source_maps_io';

const devtoolsLogger = createLogger({ module: 'devtools_source' });

export type ProbeRequest = Pick<
  DevToolsResolveRequest,
  'target' | 'selector' | 'point' | 'webContentsId'
>;

export const resolveRepoRoot = (): string | null => {
  if (app.isPackaged) return null;
  return path.resolve(app.getAppPath(), '../../../..');
};

const targetContents = (webContentsId?: number): Electron.WebContents | null => {
  if (typeof webContentsId === 'number') {
    const byId =
      typeof webContentsRegistry?.fromId === 'function'
        ? webContentsRegistry.fromId(webContentsId)
        : null;
    if (byId && !byId.isDestroyed()) return byId;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused.webContents;
  const anyWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
  return anyWindow ? anyWindow.webContents : null;
};

const installRecorder = async (contents: Electron.WebContents): Promise<void> => {
  try {
    await contents.executeJavaScript(buildInstallRecorderExpression(), true);
  } catch {
    /* empty: error is not actionable here */
  }
};

const recorderArmedWindows = new WeakSet<Electron.WebContents>();

export const armElementRecorder = (): void => {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'window') return;
    const arm = () => {
      if (contents.isDestroyed()) return;
      void installRecorder(contents);
    };
    if (!recorderArmedWindows.has(contents)) {
      recorderArmedWindows.add(contents);
      contents.on('did-finish-load', arm);
      contents.on('did-frame-finish-load', arm);
    }
    if (!contents.isLoading()) void installRecorder(contents);
  });
};

export const probeElement = async (
  contents: Electron.WebContents,
  request: ProbeRequest
): Promise<DevToolsSourceResult> => {
  const result = (await contents.executeJavaScript(
    buildProbeExpression({
      target: request.target,
      selector: request.selector,
      point: request.point,
    }),
    true
  )) as DevToolsSourceResult;
  const window = BrowserWindow.fromWebContents(contents);
  if (!window || window.isDestroyed()) return result;
  return { ...result, windowTitle: window.getTitle() };
};

export const resolveElement = async (request: ProbeRequest): Promise<DevToolsSourceResult> => {
  const contents = targetContents(request.webContentsId);
  if (!contents) return { ok: false, reason: 'no-window' };
  await installRecorder(contents);
  const result = await probeElement(contents, request);
  devtoolsLogger.event({
    level: 'debug',
    event: 'devtools.probe',
    outcome: result.ok ? 'succeeded' : 'miss',
    data: {
      target: request.target ?? 'selected',
      selector: result.locator?.selector,
      owner: result.locator?.ownerFile,
      reason: result.reason,
    },
  });
  return result;
};

export const resolveElementExact = async (
  request: DevToolsResolveRequest
): Promise<DevToolsSourceResult> => {
  const root = resolveRepoRoot();
  if (!root) return { ok: false, reason: 'packaged-build-has-no-source' };
  const contents = targetContents(request.webContentsId);
  if (!contents) return { ok: false, reason: 'no-window' };
  await installRecorder(contents);
  const probed = await probeElement(contents, request);
  if (!probed.ok) return probed;

  const scriptUrl =
    request.scriptUrl ||
    ((await contents
      .executeJavaScript(buildScriptUrlExpression(), true)
      .catch(() => '')) as string);
  if (!scriptUrl || !request.line) return probed;
  const mapped = mapBundledPosition(
    {
      scriptUrl,
      mapText: await readSourceMap(scriptUrl),
      line: request.line,
      column: request.column ?? 1,
    },
    root
  );
  return mapped ? { ...probed, mapped } : probed;
};
