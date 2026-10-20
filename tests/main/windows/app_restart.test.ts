import { describe, expect, it, vi } from 'vitest';

import {
  restartApp,
  shouldOfferRestart,
  type RelaunchDeps,
} from '../../../packages/desktop/src/main/windows/app_restart';
import { isHotReloadAvailable } from '../../../packages/desktop/src/main/ipc/dev';

const deps = (overrides: Partial<RelaunchDeps> = {}): RelaunchDeps => ({
  isPackaged: false,
  relaunch: vi.fn(),
  quit: vi.fn(),
  ...overrides,
});

describe('app restart', () => {
  it('is dev-only', () => {
    expect(shouldOfferRestart({ isPackaged: false })).toBe(true);
    expect(shouldOfferRestart({ isPackaged: true })).toBe(false);
  });

  it('relaunches before quitting, so argv (and the CDP port) survives', () => {
    const order: string[] = [];
    const target = deps({
      relaunch: () => order.push('relaunch'),
      quit: () => order.push('quit'),
    });

    expect(restartApp(target)).toBe(true);
    expect(order).toEqual(['relaunch', 'quit']);
  });

  it('refuses to relaunch a packaged build', () => {
    const target = deps({ isPackaged: true });

    expect(restartApp(target)).toBe(false);
    expect(target.relaunch).not.toHaveBeenCalled();
    expect(target.quit).not.toHaveBeenCalled();
  });
});

describe('dev runtime status', () => {
  it('treats a dev-server URL as hot-reload capable', () => {
    expect(isHotReloadAvailable('http://127.0.0.1:5173')).toBe(true);
    expect(isHotReloadAvailable('  ')).toBe(false);
    expect(isHotReloadAvailable(undefined)).toBe(false);
  });
});
