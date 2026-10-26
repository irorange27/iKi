// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

vi.mock('../../../packages/desktop/src/renderer/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import { configService } from '../../../packages/desktop/src/renderer/services/config_service';

describe('configService', () => {
  beforeEach(() => {
    loggerEventMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
  });

  const emptyHeartbeat = {
    lastReceivedAt: null,
    intervalMs: null,
    ageMs: null,
    online: null,
    good: null,
    stale: null,
  };

  it('defaults daemon log fetches to 120 lines and passes an explicit limit through', async () => {
    const getDaemonLogs = vi.fn(async (limit?: number) => ({ lines: [], limit: limit ?? 0 }));
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { config: { getDaemonLogs } },
    });

    expect(await configService.getDaemonLogs()).toEqual({ lines: [], limit: 120 });
    expect(await configService.getDaemonLogs(25)).toEqual({ lines: [], limit: 25 });
    expect(getDaemonLogs).toHaveBeenNthCalledWith(1, 120);
    expect(getDaemonLogs).toHaveBeenNthCalledWith(2, 25);
  });

  it('throws clear errors for required config methods when the bridge is missing', async () => {
    await expect(configService.get()).rejects.toThrow('window.electronAPI.config is missing');
    await expect(configService.set(createDefaultAppConfig())).rejects.toThrow(
      'window.electronAPI.config is missing'
    );
    await expect(configService.getRuntimeInfo()).rejects.toThrow(
      'window.electronAPI.config.getRuntimeInfo is missing'
    );
    await expect(configService.getDaemonStatus()).rejects.toThrow(
      'window.electronAPI.config.getDaemonStatus is missing'
    );
    await expect(configService.getDaemonLogs()).rejects.toThrow(
      'window.electronAPI.config.getDaemonLogs is missing'
    );
    await expect(configService.controlDaemon('start')).rejects.toThrow(
      'window.electronAPI.config.controlDaemon is missing'
    );
    await expect(
      configService.testNetwork({
        proxy: {
          enable: false,
          type: 'http',
          host: '',
          port: null,
        },
        webSearch: {
          preferredEngine: 'google',
        },
        timeout: 5000,
        retryAttempts: 3,
      })
    ).rejects.toThrow('window.electronAPI.config.testNetwork is missing');
  });

  it('warns and returns a noop unsubscribe when config updates are unavailable', () => {
    const unsubscribe = configService.onUpdated(vi.fn());

    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'config.subscription',
        outcome: 'skipped',
        message: 'window.electronAPI.config is missing; config updates are disabled.',
      })
    );
    expect(unsubscribe).toBeTypeOf('function');
    expect(() => unsubscribe()).not.toThrow();
  });
});
