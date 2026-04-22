// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

vi.mock('../../../src/renderer/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import { configService } from '../../../src/renderer/services/config_service';

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

  it('delegates all config IPC methods when the Electron config bridge is available', async () => {
    const config = createDefaultAppConfig();
    const get = vi.fn(async () => config);
    const set = vi.fn(async () => ({ success: true }));
    const getRuntimeInfo = vi.fn(async () => ({ configPath: '/tmp/config.json' }));
    const getDaemonStatus = vi.fn(async () => ({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'disconnected',
          activeConnectionCount: 0,
          heartbeat: emptyHeartbeat,
        },
      },
    }));
    const getDaemonLogs = vi.fn(async (limit?: number) => ({ lines: [], limit: limit ?? 0 }));
    const controlDaemon = vi.fn(async (action: string) => ({ success: true, action }));
    const testNetwork = vi.fn(async (network: unknown) => ({ success: true, network }));
    const removeListener = vi.fn();
    const onUpdated = vi.fn(() => removeListener);

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        config: {
          get,
          set,
          getRuntimeInfo,
          getDaemonStatus,
          getDaemonLogs,
          controlDaemon,
          testNetwork,
          onUpdated,
        },
      },
    });

    expect(await configService.get()).toBe(config);
    expect(await configService.set(config)).toEqual({ success: true });
    expect(await configService.getRuntimeInfo()).toEqual({ configPath: '/tmp/config.json' });
    expect(await configService.getDaemonStatus()).toEqual({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'disconnected',
          activeConnectionCount: 0,
          heartbeat: emptyHeartbeat,
        },
      },
    });
    expect(await configService.getDaemonLogs()).toEqual({ lines: [], limit: 120 });
    expect(await configService.getDaemonLogs(25)).toEqual({ lines: [], limit: 25 });
    expect(await configService.controlDaemon('restart')).toEqual({
      success: true,
      action: 'restart',
    });
    expect(
      await configService.testNetwork({
        proxy: {
          enable: true,
          type: 'socks5',
          host: '127.0.0.1',
          port: 1080,
        },
        webSearch: {
          preferredEngine: 'google',
        },
        timeout: 5000,
        retryAttempts: 3,
      })
    ).toEqual({
      success: true,
      network: {
        proxy: {
          enable: true,
          type: 'socks5',
          host: '127.0.0.1',
          port: 1080,
        },
        webSearch: {
          preferredEngine: 'google',
        },
        timeout: 5000,
        retryAttempts: 3,
      },
    });

    const callback = vi.fn();
    const unsubscribe = configService.onUpdated(callback);

    expect(get).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(config);
    expect(getDaemonLogs).toHaveBeenNthCalledWith(1, 120);
    expect(getDaemonLogs).toHaveBeenNthCalledWith(2, 25);
    expect(controlDaemon).toHaveBeenCalledWith('restart');
    expect(testNetwork).toHaveBeenCalledWith({
      proxy: {
        enable: true,
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      },
      webSearch: {
        preferredEngine: 'google',
      },
      timeout: 5000,
      retryAttempts: 3,
    });
    expect(onUpdated).toHaveBeenCalledWith(callback);
    expect(unsubscribe).toBeTypeOf('function');
    unsubscribe();
    expect(removeListener).toHaveBeenCalledTimes(1);
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
