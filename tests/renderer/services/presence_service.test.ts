// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { presenceService } from '../../../src/renderer/services/presence_service';

describe('presenceService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  it('delegates presence methods when the Electron bridge is available', async () => {
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
        presence: {
          getOverview,
          refresh,
          setOwnerMode,
          clearOwnerMode,
          onPush,
        },
      },
    });

    expect(await presenceService.getOverview()).toBe(overview);
    expect(await presenceService.refresh()).toBe(snapshot);
    expect(await presenceService.setOwnerMode('focus', 'note')).toBe(snapshot);
    expect(await presenceService.clearOwnerMode()).toBe(snapshot);

    const callback = vi.fn();
    const unsubscribe = presenceService.onPush(callback);

    expect(getOverview).toHaveBeenCalledWith(10);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setOwnerMode).toHaveBeenCalledWith('focus', 'note');
    expect(clearOwnerMode).toHaveBeenCalledTimes(1);
    expect(onPush).toHaveBeenCalledWith(callback);

    unsubscribe();

    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it('throws clear errors for required presence methods when the bridge is missing', async () => {
    await expect(presenceService.getOverview()).rejects.toThrow('window.electronAPI.presence.getOverview is missing');
    await expect(presenceService.refresh()).rejects.toThrow('window.electronAPI.presence.refresh is missing');
    await expect(presenceService.setOwnerMode('focus')).rejects.toThrow(
      'window.electronAPI.presence.setOwnerMode is missing'
    );
    await expect(presenceService.clearOwnerMode()).rejects.toThrow(
      'window.electronAPI.presence.clearOwnerMode is missing'
    );
    expect(() => presenceService.onPush(vi.fn())).not.toThrow();
  });
});
