// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateService } from '../../../packages/desktop/src/renderer/services/update_service';

describe('updateService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  it('delegates updater methods when the Electron bridge is available', async () => {
    const status = {
      state: 'idle',
      autoUpdateEnabled: true,
      supported: true,
      checkIntervalMs: 21600000,
      currentVersion: '0.0.1',
      lastCheckedAt: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      updateUrl: null,
      error: null,
      unsupportedReason: null,
    } as const;
    const getStatus = vi.fn(async () => status);
    const check = vi.fn(async () => ({ ...status, state: 'checking' as const }));
    const install = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    const onStatusChanged = vi.fn(() => unsubscribe);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        updates: {
          getStatus,
          check,
          install,
          onStatusChanged,
          removeAllListeners: vi.fn(),
        },
      },
    });

    expect(await updateService.getStatus()).toEqual(status);
    expect(await updateService.check()).toEqual(expect.objectContaining({ state: 'checking' }));
    await updateService.install();

    const callback = vi.fn();
    const removeListener = updateService.onStatusChanged(callback);

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(onStatusChanged).toHaveBeenCalledWith(callback);

    removeListener();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('throws clear errors when the updates bridge is missing', async () => {
    await expect(updateService.getStatus()).rejects.toThrow('window.electronAPI.updates is missing');
    await expect(updateService.check()).rejects.toThrow('window.electronAPI.updates is missing');
    await expect(updateService.install()).rejects.toThrow('window.electronAPI.updates is missing');
    expect(() => updateService.onStatusChanged(vi.fn())).not.toThrow();
  });
});
