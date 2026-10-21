import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

import {
  createDevToolsToggleAction,
  maybeOpenDevTools,
  parseBooleanEnv,
  shouldAutoOpenDevTools,
  toggleDevTools,
} from '../../../packages/desktop/src/main/windows/devtools_policy';

describe('devtools policy', () => {
  it('parses supported boolean env values', () => {
    expect(parseBooleanEnv('1')).toBe(true);
    expect(parseBooleanEnv('true')).toBe(true);
    expect(parseBooleanEnv(' YES ')).toBe(true);
    expect(parseBooleanEnv('on')).toBe(true);

    expect(parseBooleanEnv('0')).toBe(false);
    expect(parseBooleanEnv('false')).toBe(false);
    expect(parseBooleanEnv(' no ')).toBe(false);
    expect(parseBooleanEnv('off')).toBe(false);
  });

  it('returns null for unsupported env values', () => {
    expect(parseBooleanEnv(undefined)).toBeNull();
    expect(parseBooleanEnv('')).toBeNull();
    expect(parseBooleanEnv('open')).toBeNull();
  });

  it('auto-opens devtools by default in development', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: false,
        autoOpenEnv: undefined,
      })
    ).toBe(true);
  });

  it('supports explicit opt-out in development', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: false,
        autoOpenEnv: 'false',
      })
    ).toBe(false);
  });

  it('supports explicit opt-in in development', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: false,
        autoOpenEnv: 'true',
      })
    ).toBe(true);
  });

  it('always disables auto-open in packaged builds', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: true,
        autoOpenEnv: 'true',
      })
    ).toBe(false);
  });

  it('opens devtools only when policy allows', () => {
    const webContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      openDevTools: vi.fn(),
    } satisfies Pick<WebContents, 'isDestroyed' | 'openDevTools'>;

    maybeOpenDevTools(webContents as WebContents, {
      isPackaged: false,
      autoOpenEnv: 'true',
    });
    expect(webContents.openDevTools).toHaveBeenCalledTimes(1);

    maybeOpenDevTools(webContents as WebContents, {
      isPackaged: false,
      autoOpenEnv: 'false',
    });
    expect(webContents.openDevTools).toHaveBeenCalledTimes(1);
  });
});

type ToggleStubOptions = {
  open?: boolean;
  devToolsEnabled?: boolean;
  url?: string;
  destroyed?: boolean;
};

const createToggleableContents = (options: ToggleStubOptions = {}) => {
  const webContents = {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isDevToolsOpened: vi.fn(() => options.open ?? false),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn(),
    getURL: vi.fn(() => options.url ?? 'file:///app/index.html'),
    devToolsEnabled: options.devToolsEnabled,
  };
  return webContents;
};

describe('on-demand devtools toggle', () => {
  it('opens a closed pane', () => {
    // Packaging plays no part: the same code path opens DevTools in a shipped
    // app, which is the whole point of the menu accelerator.
    const webContents = createToggleableContents();
    expect(toggleDevTools(webContents as unknown as WebContents)).toBe(true);
    expect(webContents.openDevTools).toHaveBeenCalledTimes(1);
    expect(webContents.closeDevTools).not.toHaveBeenCalled();
  });

  it('closes an already-open pane instead of re-focusing it', () => {
    const webContents = createToggleableContents({ open: true });
    expect(toggleDevTools(webContents as unknown as WebContents)).toBe(false);
    expect(webContents.closeDevTools).toHaveBeenCalledTimes(1);
    expect(webContents.openDevTools).not.toHaveBeenCalled();
  });

  it('skips a window whose devTools were disabled at construction', () => {
    // settings_window / companion_window used to pass devTools: !app.isPackaged,
    // which made F12 in a packaged build throw instead of opening.
    const webContents = createToggleableContents({ devToolsEnabled: false });
    expect(toggleDevTools(webContents as unknown as WebContents)).toBe(false);
    expect(webContents.openDevTools).not.toHaveBeenCalled();
  });

  it('skips the inspector page and destroyed contents', () => {
    const inspector = createToggleableContents({ url: 'devtools://devtools/bundled/x.html' });
    expect(toggleDevTools(inspector as unknown as WebContents)).toBe(false);

    const destroyed = createToggleableContents({ destroyed: true });
    expect(toggleDevTools(destroyed as unknown as WebContents)).toBe(false);
  });

  it('resolves the toggle target at click time, not menu build time', () => {
    const first = createToggleableContents();
    const second = createToggleableContents();
    let current = first;
    const toggle = createDevToolsToggleAction(
      () => current as unknown as WebContents,
      { mode: 'detach' }
    );

    toggle();
    current = second;
    toggle();

    expect(first.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    expect(second.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
  });

  it('does nothing when no window is available', () => {
    const toggle = createDevToolsToggleAction(() => null);
    expect(toggle()).toBe(false);
  });
});

