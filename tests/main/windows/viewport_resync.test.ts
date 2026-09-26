import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import {
  attachViewportResyncGuard,
  resyncViewportIfNeeded,
} from '../../../packages/desktop/src/main/windows/viewport_resync';

vi.mock('@iki/backend/logger', () => ({
  createLogger: () => ({ event: vi.fn() }),
}));

type StubOptions = {
  contentSize?: [number, number];
  viewport?: [number, number];
  devToolsOpen?: boolean;
  zoomFactor?: number;
  destroyed?: boolean;
};

const createStubWindow = (options: StubOptions = {}) => {
  const handlers = new Map<string, Array<() => void>>();
  const win = {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    getContentSize: vi.fn(() => options.contentSize ?? [900, 680]),
    setContentSize: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    webContents: {
      isDestroyed: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => options.devToolsOpen ?? false),
      getZoomFactor: vi.fn(() => options.zoomFactor ?? 1),
      executeJavaScript: vi.fn(() => Promise.resolve(options.viewport ?? [900, 680])),
      on: vi.fn((event: string, handler: () => void) => {
        const list = handlers.get(`wc:${event}`) ?? [];
        list.push(handler);
        handlers.set(`wc:${event}`, list);
      }),
    },
    emit: (event: string) => {
      for (const handler of handlers.get(event) ?? []) handler();
    },
  };
  return win as unknown as BrowserWindow & { emit: (event: string) => void; setContentSize: ReturnType<typeof vi.fn> };
};

describe('viewport resync guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forces a re-layout when the renderer viewport lags the window size', async () => {
    const win = createStubWindow({ contentSize: [1351, 795], viewport: [900, 680] });
    attachViewportResyncGuard(win);
    win.emit('resize');
    await vi.advanceTimersByTimeAsync(400);
    expect(win.setContentSize).toHaveBeenCalledTimes(2);
    expect(win.setContentSize).toHaveBeenNthCalledWith(1, 1352, 795);
    expect(win.setContentSize).toHaveBeenNthCalledWith(2, 1351, 795);
  });

  it('stays idle when the viewport matches the content size', async () => {
    const win = createStubWindow({ contentSize: [1351, 795], viewport: [1351, 795] });
    attachViewportResyncGuard(win);
    win.emit('resize');
    await vi.advanceTimersByTimeAsync(400);
    expect(win.setContentSize).not.toHaveBeenCalled();
  });

  it('skips the check while a docked DevTools pane splits the viewport', async () => {
    const win = createStubWindow({ contentSize: [900, 680], viewport: [345, 680], devToolsOpen: true });
    attachViewportResyncGuard(win);
    win.emit('resize');
    await vi.advanceTimersByTimeAsync(400);
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(win.setContentSize).not.toHaveBeenCalled();
  });

  it('skips the check while the page is zoomed', async () => {
    const win = createStubWindow({ contentSize: [900, 680], viewport: [450, 340], zoomFactor: 2 });
    attachViewportResyncGuard(win);
    win.emit('resize');
    await vi.advanceTimersByTimeAsync(400);
    expect(win.setContentSize).not.toHaveBeenCalled();
  });

  it('rechecks immediately when DevTools closes', async () => {
    const win = createStubWindow({ contentSize: [1351, 795], viewport: [900, 680] });
    attachViewportResyncGuard(win);
    win.emit('wc:devtools-closed');
    await vi.advanceTimersByTimeAsync(0);
    expect(win.setContentSize).toHaveBeenCalledTimes(2);
    expect(win.setContentSize).toHaveBeenNthCalledWith(1, 1352, 795);
    expect(win.setContentSize).toHaveBeenNthCalledWith(2, 1351, 795);
  });

  it('does not nudge a destroyed window mid-check', async () => {
    const win = createStubWindow({ contentSize: [1351, 795], viewport: [900, 680] });
    const stub = win as unknown as { isDestroyed: ReturnType<typeof vi.fn> };
    stub.isDestroyed.mockReturnValue(true);
    resyncViewportIfNeeded(win);
    await vi.advanceTimersByTimeAsync(0);
    expect(win.setContentSize).not.toHaveBeenCalled();
  });
});
