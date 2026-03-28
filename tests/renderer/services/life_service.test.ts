// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lifeService } from '../../../src/renderer/services/life_service';

describe('lifeService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  it('delegates life methods when the Electron bridge is available', async () => {
    const overview = { episodes: [], current: null } as const;
    const snapshot = { state: null, currentEpisode: null, recentEpisodes: [] } as const;
    const getOverview = vi.fn(async () => overview);
    const refresh = vi.fn(async () => snapshot);
    const setOwnerMode = vi.fn(async () => snapshot);
    const clearOwnerMode = vi.fn(async () => snapshot);
    const removeListener = vi.fn();
    const onPush = vi.fn(() => removeListener);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        life: {
          getOverview,
          refresh,
          setOwnerMode,
          clearOwnerMode,
          onPush,
        },
      },
    });

    expect(await lifeService.getOverview()).toBe(overview);
    expect(await lifeService.refresh()).toBe(snapshot);
    expect(await lifeService.setOwnerMode('focus', 'note')).toBe(snapshot);
    expect(await lifeService.clearOwnerMode()).toBe(snapshot);

    const callback = vi.fn();
    const unsubscribe = lifeService.onPush(callback);

    expect(getOverview).toHaveBeenCalledWith(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setOwnerMode).toHaveBeenCalledWith('focus', 'note');
    expect(clearOwnerMode).toHaveBeenCalledTimes(1);
    expect(onPush).toHaveBeenCalledWith(callback);

    unsubscribe();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it('throws clear errors for required life methods when the bridge is missing', async () => {
    await expect(lifeService.getOverview()).rejects.toThrow('window.electronAPI.life.getOverview is missing');
    await expect(lifeService.refresh()).rejects.toThrow('window.electronAPI.life.refresh is missing');
    await expect(lifeService.setOwnerMode('focus')).rejects.toThrow(
      'window.electronAPI.life.setOwnerMode is missing'
    );
    await expect(lifeService.clearOwnerMode()).rejects.toThrow(
      'window.electronAPI.life.clearOwnerMode is missing'
    );
    expect(() => lifeService.onPush(vi.fn())).not.toThrow();
  });
});
