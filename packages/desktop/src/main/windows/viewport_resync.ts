import type { BrowserWindow } from 'electron';

import { createLogger } from '@iki/backend/logger';

const windowLogger = createLogger({ module: 'main_window' });

const VIEWPORT_RESYNC_DEBOUNCE_MS = 400;

export const resyncViewportIfNeeded = (win: BrowserWindow): void => {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  if (win.webContents.isDevToolsOpened() || win.webContents.getZoomFactor() !== 1) return;
  void win.webContents
    .executeJavaScript('[window.innerWidth, window.innerHeight]', true)
    .then(viewport => {
      const [width, height] = win.getContentSize();
      if (win.isDestroyed() || (viewport[0] === width && viewport[1] === height)) return;
      windowLogger.event({
        level: 'warn',
        event: 'window.viewport_desync',
        outcome: 'attempt',
        message: 'Renderer viewport out of sync with window content size; forcing re-layout',
        data: {
          window_kind: 'main',
          viewport: viewport.join('x'),
          content_size: `${width}x${height}`,
        },
      });
      win.setContentSize(width + 1, height);
      win.setContentSize(width, height);
    })
    .catch((): void => undefined);
};

export const attachViewportResyncGuard = (win: BrowserWindow): void => {
  let resyncTimer: NodeJS.Timeout | null = null;
  win.on('resize', () => {
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => resyncViewportIfNeeded(win), VIEWPORT_RESYNC_DEBOUNCE_MS);
  });
  win.webContents.on('devtools-closed', () => resyncViewportIfNeeded(win));
  win.on('closed', () => {
    if (resyncTimer) clearTimeout(resyncTimer);
  });
};
