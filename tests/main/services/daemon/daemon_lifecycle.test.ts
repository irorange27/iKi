import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RequestEvent = 'error' | 'timeout';
type HealthResponseEvent = 'data' | 'end';
type HealthResponseMock = {
  statusCode: number;
  setEncoding: ReturnType<typeof vi.fn>;
  on: (event: HealthResponseEvent, handler: (...args: unknown[]) => void) => HealthResponseMock;
};

const {
  requestMock,
  spawnMock,
  startDaemonServerMock,
  getAppConfigMock,
  getPathMock,
  getLocaleMock,
  daemonLoggerEventMock,
} = vi.hoisted(() => ({
  requestMock: vi.fn(),
  spawnMock: vi.fn(),
  startDaemonServerMock: vi.fn(),
  getAppConfigMock: vi.fn(() => ({
    daemon: {
      host: '127.0.0.1',
      port: 6127,
    },
  })),
  getPathMock: vi.fn(() => '/tmp/iki-user-data'),
  getLocaleMock: vi.fn(() => 'en-US'),
  daemonLoggerEventMock: vi.fn(),
}));

vi.mock('node:http', () => ({
  default: {
    request: requestMock,
  },
  request: requestMock,
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
    getLocale: getLocaleMock,
  },
}));

vi.mock('../../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../../src/daemon/server', () => ({
  startDaemonServer: startDaemonServerMock,
}));

vi.mock('../../../../src/core/daemon_logs', () => ({
  createDaemonLogger: vi.fn(() => ({
    event: daemonLoggerEventMock,
  })),
  daemonLog: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockHealthOffline = () => {
  requestMock.mockImplementation(() => {
    const listeners: Partial<Record<RequestEvent, (...args: unknown[]) => void>> = {};
    const req = {
      on: vi.fn((event: RequestEvent, handler: (...args: unknown[]) => void) => {
        listeners[event] = handler;
        return req;
      }),
      destroy: vi.fn(),
      end: vi.fn(() => {
        listeners.error?.(new Error('ECONNREFUSED'));
      }),
    };
    return req;
  });
};

const mockHealthOnline = (host = '127.0.0.1', port = 6127) => {
  requestMock.mockImplementation(
    (_options: unknown, callback: (response: HealthResponseMock) => void) => {
    const req = {
      on: vi.fn(() => req),
      destroy: vi.fn(),
      end: vi.fn(() => {
        const response: HealthResponseMock = {
          statusCode: 200,
          setEncoding: vi.fn(),
          on: (event, handler) => {
            if (event === 'data') {
              handler(JSON.stringify({ status: 'ok', host, port }));
            }
            if (event === 'end') {
              handler();
            }
            return response;
          },
        };
        callback(response);
      }),
    };
    return req;
    }
  );
};

const mockHealthMalformedJson = () => {
  requestMock.mockImplementation(
    (_options: unknown, callback: (response: HealthResponseMock) => void) => {
      const req = {
        on: vi.fn(() => req),
        destroy: vi.fn(),
        end: vi.fn(() => {
          const response: HealthResponseMock = {
            statusCode: 200,
            setEncoding: vi.fn(),
            on: (event, handler) => {
              if (event === 'data') {
                handler('not-json');
              }
              if (event === 'end') {
                handler();
              }
              return response;
            },
          };
          callback(response);
        }),
      };
      return req;
    }
  );
};

const setupDaemonServerReturn = () => {
  startDaemonServerMock.mockReturnValue({
    server: {
      close: vi.fn(),
    },
    wss: {
      close: vi.fn(),
    },
    host: '127.0.0.1',
    port: 6127,
    ready: Promise.resolve(),
    shutdown: vi.fn(),
  });
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
  delete process.env.IKI_DAEMON_AUTOSTART;
  process.argv = ['/usr/local/bin/electron', '/tmp/main.js'];
  setupDaemonServerReturn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('daemon lifecycle', () => {
  it('starts embedded daemon in desktop mode without spawning a second Electron process', async () => {
    mockHealthOffline();
    const { startDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    const started = startDesktopDaemon();
    await vi.runAllTimersAsync();
    await started;

    expect(startDaemonServerMock).toHaveBeenCalledTimes(1);
    expect(startDaemonServerMock).toHaveBeenCalledWith({ host: '127.0.0.1', port: 6127 });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('skips embedded startup when an existing daemon is already healthy on the configured binding', async () => {
    mockHealthOnline('127.0.0.1', 6127);
    const { startDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    await startDesktopDaemon();

    expect(startDaemonServerMock).not.toHaveBeenCalled();
    expect(daemonLoggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        event: 'daemon.lifecycle.start',
        outcome: 'skipped',
        message: 'Existing daemon detected on 127.0.0.1:6127, skipping embedded startup.',
      })
    );
  });

  it('honors IKI_DAEMON_AUTOSTART=false', async () => {
    process.env.IKI_DAEMON_AUTOSTART = 'false';
    mockHealthOffline();
    const { startDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    await startDesktopDaemon();

    expect(startDaemonServerMock).not.toHaveBeenCalled();
  });

  it('allows manual start to bypass IKI_DAEMON_AUTOSTART=false', async () => {
    process.env.IKI_DAEMON_AUTOSTART = 'false';
    mockHealthOffline();
    const { startDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    const started = startDesktopDaemon({ ignoreAutostartEnv: true });
    await vi.runAllTimersAsync();
    await started;

    expect(startDaemonServerMock).toHaveBeenCalledTimes(1);
    expect(startDaemonServerMock).toHaveBeenCalledWith({ host: '127.0.0.1', port: 6127 });
  });

  it('logs config fallback and uses default binding when config lookup fails', async () => {
    getAppConfigMock.mockImplementationOnce(() => {
      throw new Error('config unavailable');
    });
    mockHealthOffline();
    const { startDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    const started = startDesktopDaemon();
    await vi.runAllTimersAsync();
    await started;

    expect(startDaemonServerMock).toHaveBeenCalledTimes(1);
    expect(startDaemonServerMock).toHaveBeenCalledWith({ host: '127.0.0.1', port: 6127 });
    expect(daemonLoggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'daemon.lifecycle.config',
        outcome: 'degraded',
        message: 'Failed to read daemon binding from config; using defaults.',
      })
    );
  });

  it('logs malformed health payloads before falling back to default binding metadata', async () => {
    mockHealthMalformedJson();
    const { startDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    await startDesktopDaemon();

    expect(startDaemonServerMock).not.toHaveBeenCalled();
    expect(daemonLoggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'daemon.lifecycle.healthcheck',
        outcome: 'degraded',
        message: 'Daemon health response was not valid JSON; using fallback binding.',
        data: expect.objectContaining({
          probe_host: '127.0.0.1',
          probe_port: 6127,
          status: 200,
        }),
      })
    );
  });

  it('uses the daemon shutdown hook when stopping an embedded daemon', async () => {
    let requestCount = 0;
    requestMock.mockImplementation(
      (_options: unknown, callback: (response: HealthResponseMock) => void) => {
        const listeners: Partial<Record<RequestEvent, (...args: unknown[]) => void>> = {};
        const req = {
          on: vi.fn((event: RequestEvent, handler: (...args: unknown[]) => void) => {
            listeners[event] = handler;
            return req;
          }),
          destroy: vi.fn(),
          end: vi.fn(() => {
            requestCount += 1;
            if (requestCount === 1) {
              listeners.error?.(new Error('ECONNREFUSED'));
              return;
            }

            const response: HealthResponseMock = {
              statusCode: 200,
              setEncoding: vi.fn(),
              on: (event, handler) => {
                if (event === 'data') {
                  handler(JSON.stringify({ status: 'ok', host: '127.0.0.1', port: 6127 }));
                }
                if (event === 'end') {
                  handler();
                }
                return response;
              },
            };
            callback(response);
          }),
        };
        return req;
      }
    );
    const { startDesktopDaemon, stopDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    const started = startDesktopDaemon();
    await vi.runAllTimersAsync();
    await started;

    expect(stopDesktopDaemon()).toBe(true);
    expect(startDaemonServerMock.mock.results[0]?.value.shutdown).toHaveBeenCalledTimes(1);
    expect(startDaemonServerMock.mock.results[0]?.value.server.close).not.toHaveBeenCalled();
    expect(startDaemonServerMock.mock.results[0]?.value.wss.close).not.toHaveBeenCalled();
  });

  it('stops and clears the embedded daemon when startup readiness rejects', async () => {
    mockHealthOffline();
    const startupError = new Error('EADDRINUSE');
    startDaemonServerMock.mockReturnValueOnce({
      server: {
        close: vi.fn(),
      },
      wss: {
        close: vi.fn(),
      },
      host: '127.0.0.1',
      port: 6127,
      ready: Promise.reject(startupError),
      shutdown: vi.fn(),
    });

    const { startDesktopDaemon, isDesktopDaemonEmbeddedRunning } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    await startDesktopDaemon();

    expect(startDaemonServerMock.mock.results[0]?.value.shutdown).toHaveBeenCalledTimes(1);
    expect(isDesktopDaemonEmbeddedRunning()).toBe(false);
    expect(daemonLoggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'daemon.lifecycle.start',
        outcome: 'failed',
        message: 'Embedded daemon failed during startup.',
        error: startupError,
      })
    );
  });
});
