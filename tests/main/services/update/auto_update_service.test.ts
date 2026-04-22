import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { defaultAutoUpdaterMock, defaultShowMessageBoxMock } = vi.hoisted(() => ({
  defaultAutoUpdaterMock: {
    on: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  defaultShowMessageBoxMock: vi.fn(async () => ({ response: 1 })),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.1',
    getAppPath: () => '/tmp/iki-app',
    isPackaged: true,
  },
  autoUpdater: defaultAutoUpdaterMock,
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showMessageBox: defaultShowMessageBoxMock,
  },
}));

import {
  buildUpdateFeedUrl,
  createAppUpdateService,
  parseGitHubRepository,
} from '../../../../src/main/services/update/auto_update_service';
import { createDefaultAppConfig } from '../../../../src/shared/config/defaults';

type AutoUpdaterMock = EventEmitter & {
  setFeedURL: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
};

const createAutoUpdaterMock = (): AutoUpdaterMock => {
  const emitter = new EventEmitter() as AutoUpdaterMock;
  emitter.setFeedURL = vi.fn();
  emitter.checkForUpdates = vi.fn();
  emitter.quitAndInstall = vi.fn();
  return emitter;
};

const createServiceHarness = (overrides?: {
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  argv?: string[];
  autoUpdate?: boolean;
}) => {
  const autoUpdater = createAutoUpdaterMock();
  const sendMock = vi.fn();
  const showMessageBox = vi.fn(async () => ({ response: 1 }));
  const setIntervalFn = vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>);
  const clearIntervalFn = vi.fn();

  const config = createDefaultAppConfig();
  config.general.autoUpdate = overrides?.autoUpdate ?? true;

  const service = createAppUpdateService({
    app: {
      getVersion: () => '0.0.1',
      getAppPath: () => '/tmp/iki-app',
      isPackaged: overrides?.isPackaged ?? true,
    },
    autoUpdater,
    dialog: {
      showMessageBox,
    },
    getAllWindows: () =>
      [
        {
          webContents: {
            send: sendMock,
          },
        },
      ] as never,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      event: vi.fn(),
      span: vi.fn(),
    } as never,
    platform: overrides?.platform ?? 'darwin',
    arch: 'arm64',
    argv: overrides?.argv ?? [],
    env: {},
    setIntervalFn,
    clearIntervalFn,
    readFileSync: vi.fn(() =>
      JSON.stringify({
        repository: {
          url: 'git+https://github.com/irorange27/iKi.git',
        },
      })
    ),
  });

  return {
    service,
    autoUpdater,
    sendMock,
    showMessageBox,
    setIntervalFn,
    clearIntervalFn,
    config,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-27T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('app update service', () => {
  it('parses GitHub repository metadata and builds the public update feed URL', () => {
    expect(parseGitHubRepository('git+https://github.com/irorange27/iKi.git')).toEqual({
      owner: 'irorange27',
      name: 'iKi',
    });
    expect(buildUpdateFeedUrl({
      owner: 'irorange27',
      name: 'iKi',
      version: '0.0.1',
      platform: 'darwin',
      arch: 'arm64',
    })).toBe('https://update.electronjs.org/irorange27/iKi/darwin-arm64/0.0.1');
  });

  it('configures the feed URL, schedules checks, and reacts to update results', () => {
    const { service, autoUpdater, setIntervalFn, config, sendMock } = createServiceHarness();

    service.start(config);

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: 'https://update.electronjs.org/irorange27/iKi/darwin-arm64/0.0.1',
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);

    autoUpdater.emit('update-not-available');

    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        state: 'up-to-date',
        supported: true,
        checkIntervalMs: 21600000,
        lastCheckedAt: '2026-03-27T00:00:00.000Z',
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      'updates:status-changed',
      expect.objectContaining({
        state: 'up-to-date',
      })
    );
  });

  it('reports unsupported states for unpackaged builds and does not start checks', () => {
    const { service, autoUpdater, config } = createServiceHarness({
      isPackaged: false,
      autoUpdate: false,
    });

    service.start(config);

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        state: 'unsupported',
        supported: false,
        unsupportedReason: 'not-packaged',
      })
    );
  });

  it('reports Windows packages as unsupported under the current macOS-only release policy', () => {
    const { service, autoUpdater, config } = createServiceHarness({
      platform: 'win32',
    });

    service.start(config);

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        state: 'unsupported',
        supported: false,
        unsupportedReason: 'platform',
      })
    );
  });

  it('prompts for restart after a download and installs immediately when accepted', async () => {
    const { service, autoUpdater, showMessageBox, config } = createServiceHarness();
    showMessageBox.mockResolvedValueOnce({ response: 0 });

    service.start(config);
    autoUpdater.emit(
      'update-downloaded',
      {},
      'v0.0.2',
      'v0.0.2',
      new Date('2026-03-28T00:00:00.000Z'),
      'https://github.com/irorange27/iKi/releases/tag/v0.0.2'
    );

    await vi.runAllTimersAsync();

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        state: 'downloaded',
        releaseName: 'v0.0.2',
      })
    );
  });
});
