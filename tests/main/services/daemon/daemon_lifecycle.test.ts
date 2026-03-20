import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requestMock,
  spawnMock,
  startDaemonServerMock,
  getAppConfigMock,
  getPathMock,
  getLocaleMock,
  daemonLogInfoMock,
  daemonLogWarnMock,
} = vi.hoisted(() => ({
  requestMock: vi.fn(),
  spawnMock: vi.fn(),
  startDaemonServerMock: vi.fn(),
  getAppConfigMock: vi.fn(() => ({
    daemon: {
      host: '0.0.0.0',
      port: 6127,
    },
  })),
  getPathMock: vi.fn(() => '/tmp/iki-user-data'),
  getLocaleMock: vi.fn(() => 'en-US'),
  daemonLogInfoMock: vi.fn(),
  daemonLogWarnMock: vi.fn(),
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
  daemonLog: {
    info: daemonLogInfoMock,
    warn: daemonLogWarnMock,
  },
}));

type RequestEvent = 'error' | 'timeout';

const mockHealthOffline = () => {
  requestMock.mockImplementation((_options: unknown, _callback: unknown) => {
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

const mockHealthOnline = (host = '0.0.0.0', port = 6127) => {
  requestMock.mockImplementation((_options: unknown, callback: (response: any) => void) => {
    const req = {
      on: vi.fn(() => req),
      destroy: vi.fn(),
      end: vi.fn(() => {
        const response = {
          statusCode: 200,
          setEncoding: vi.fn(),
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') {
              handler(JSON.stringify({ status: 'ok', host, port }));
            }
            if (event === 'end') {
              handler();
            }
            return response;
          }),
        };
        callback(response);
      }),
    };
    return req;
  });
};

const setupDaemonServerReturn = () => {
  startDaemonServerMock.mockReturnValue({
    server: {
      close: vi.fn(),
    },
    wss: {
      close: vi.fn(),
    },
    host: '0.0.0.0',
    port: 6127,
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
    expect(startDaemonServerMock).toHaveBeenCalledWith({ host: '0.0.0.0', port: 6127 });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('skips embedded startup when an existing daemon is already healthy on the configured binding', async () => {
    mockHealthOnline('0.0.0.0', 6127);
    const { startDesktopDaemon } = await import(
      '../../../../src/main/services/daemon/daemon_lifecycle'
    );

    await startDesktopDaemon();

    expect(startDaemonServerMock).not.toHaveBeenCalled();
    expect(daemonLogInfoMock).toHaveBeenCalledWith(
      'daemon-lifecycle',
      'Existing daemon detected on 0.0.0.0:6127, skipping embedded startup.',
      undefined,
      '/tmp/iki-user-data'
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
    expect(startDaemonServerMock).toHaveBeenCalledWith({ host: '0.0.0.0', port: 6127 });
  });
});
