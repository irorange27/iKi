import fs from 'node:fs';
import path from 'node:path';
import { app, autoUpdater, BrowserWindow, dialog } from 'electron';

import type { AppConfig } from '@iki/core/types/config';
import type { AppUpdateStatus, AppUpdateUnsupportedReason } from '@iki/core/types/update';
import { createLogger } from '@iki/core/logger';
import { getAllBrowserWindows } from '../../utils/browser_windows';

const UPDATE_SERVER_BASE_URL = 'https://update.electronjs.org';
const DEFAULT_GITHUB_REPOSITORY = 'irorange27/iKi';
const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_STATUS_CHANNEL = 'updates:status-changed';

type AppUpdateServiceDeps = {
  app: Pick<typeof app, 'getVersion' | 'getAppPath'> & { isPackaged: boolean };
  autoUpdater: Pick<
    typeof autoUpdater,
    'on' | 'setFeedURL' | 'checkForUpdates' | 'quitAndInstall'
  >;
  dialog: Pick<typeof dialog, 'showMessageBox'>;
  getAllWindows: typeof BrowserWindow.getAllWindows;
  logger: ReturnType<typeof createLogger>;
  platform: NodeJS.Platform;
  arch: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
  readFileSync: typeof fs.readFileSync;
};

type PackageJsonLike = {
  repository?: string | { url?: string };
};

const createBaseStatus = (): AppUpdateStatus => ({
  state: 'idle',
  autoUpdateEnabled: true,
  supported: false,
  checkIntervalMs: null,
  currentVersion: '0.0.0',
  lastCheckedAt: null,
  releaseName: null,
  releaseDate: null,
  releaseNotes: null,
  updateUrl: null,
  error: null,
  unsupportedReason: null,
});

const normalizeRepositoryValue = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (
    typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    typeof value.url === 'string' &&
    value.url.trim()
  ) {
    return value.url.trim();
  }
  return null;
};

export const parseGitHubRepository = (value: unknown): { owner: string; name: string } | null => {
  const raw = normalizeRepositoryValue(value);
  if (!raw) return null;

  const normalized = raw
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/i, '');
  const match = normalized.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) return null;
  const owner = match[1]?.trim();
  const name = match[2]?.trim();
  if (!owner || !name) return null;
  return { owner, name };
};

const parseDefaultGitHubRepository = (): { owner: string; name: string } => {
  const [owner, name] = DEFAULT_GITHUB_REPOSITORY.split('/');
  return { owner, name };
};

const resolveGitHubRepository = (
  deps: Pick<AppUpdateServiceDeps, 'app' | 'env' | 'readFileSync'>
): { owner: string; name: string } | null => {
  const envRepository = deps.env.IKI_UPDATER_REPOSITORY?.trim();
  if (envRepository) {
    return parseGitHubRepository(envRepository);
  }

  try {
    const packageJsonPath = path.join(deps.app.getAppPath(), 'package.json');
    const parsed = JSON.parse(deps.readFileSync(packageJsonPath, 'utf8')) as PackageJsonLike;
    const repository = parseGitHubRepository(parsed.repository);
    if (repository) return repository;
  } catch {
    // Fall back to the canonical release repository below.
  }

  return parseDefaultGitHubRepository();
};

export const buildUpdateFeedUrl = (params: {
  owner: string;
  name: string;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
}): string =>
  `${UPDATE_SERVER_BASE_URL}/${params.owner}/${params.name}/${params.platform}-${params.arch}/${params.version}`;

const isSupportedPlatform = (platform: NodeJS.Platform): boolean => platform === 'darwin';

export const createAppUpdateService = (deps: AppUpdateServiceDeps) => {
  let started = false;
  let busy = false;
  let feedUrl: string | null = null;
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let autoUpdateEnabled = true;
  let status: AppUpdateStatus = {
    ...createBaseStatus(),
    currentVersion: deps.app.getVersion(),
  };

  const broadcastStatus = () => {
    const payload = { ...status };
    for (const win of deps.getAllWindows()) {
      win.webContents.send(UPDATE_STATUS_CHANNEL, payload);
    }
  };

  const setStatus = (next: Partial<AppUpdateStatus>) => {
    status = {
      ...status,
      ...next,
      autoUpdateEnabled,
      currentVersion: deps.app.getVersion(),
    };
    broadcastStatus();
  };

  const clearScheduledChecks = () => {
    if (!checkTimer) return;
    deps.clearIntervalFn(checkTimer);
    checkTimer = null;
    setStatus({ checkIntervalMs: null });
  };

  const getUnsupportedReason = (): AppUpdateUnsupportedReason | null => {
    if (!isSupportedPlatform(deps.platform)) return 'platform';
    if (!deps.app.isPackaged) return 'not-packaged';
    return null;
  };

  const ensureFeedUrl = (): boolean => {
    const unsupportedReason = getUnsupportedReason();
    if (unsupportedReason) {
      feedUrl = null;
      setStatus({
        state: 'unsupported',
        supported: false,
        unsupportedReason,
        error: null,
      });
      return false;
    }

    if (feedUrl) return true;

    const repository = resolveGitHubRepository(deps);
    if (!repository) {
      setStatus({
        state: 'unsupported',
        supported: false,
        unsupportedReason: 'repository-unavailable',
        error: null,
      });
      return false;
    }

    feedUrl = buildUpdateFeedUrl({
      ...repository,
      version: deps.app.getVersion(),
      platform: deps.platform,
      arch: deps.arch,
    });
    deps.autoUpdater.setFeedURL({ url: feedUrl });
    setStatus({
      state: status.state === 'unsupported' ? 'idle' : status.state,
      supported: true,
      unsupportedReason: null,
      error: null,
    });
    return true;
  };

  const finishCheck = (next: Partial<AppUpdateStatus>) => {
    busy = false;
    setStatus({
      ...next,
      lastCheckedAt: new Date().toISOString(),
    });
  };

  const checkForUpdates = (reason: 'startup' | 'scheduled' | 'manual'): AppUpdateStatus => {
    if (status.state === 'downloaded' || busy) {
      return { ...status };
    }

    if (!ensureFeedUrl()) {
      return { ...status };
    }

    busy = true;
    setStatus({
      state: 'checking',
      error: null,
      unsupportedReason: null,
    });

    deps.logger.event({
      level: 'info',
      event: 'app_update.check',
      message: 'Checking for application updates.',
      data: {
        reason,
        feed_url: feedUrl,
      },
    });

    try {
      deps.autoUpdater.checkForUpdates();
    } catch (error) {
      finishCheck({
        state: 'error',
        error: error instanceof Error ? error.message : 'Failed to start update check.',
      });
      deps.logger.event({
        level: 'error',
        event: 'app_update.check',
        outcome: 'failed',
        error,
        message: 'Application update check failed to start.',
      });
    }

    return { ...status };
  };

  const scheduleAutomaticChecks = (runImmediateCheck: boolean) => {
    clearScheduledChecks();
    if (!autoUpdateEnabled) {
      if (!ensureFeedUrl()) {
        return;
      }
      setStatus({
        checkIntervalMs: null,
      });
      return;
    }

    if (!ensureFeedUrl()) {
      return;
    }

    checkTimer = deps.setIntervalFn(() => {
      checkForUpdates('scheduled');
    }, AUTO_UPDATE_INTERVAL_MS);
    setStatus({
      supported: true,
      checkIntervalMs: AUTO_UPDATE_INTERVAL_MS,
      state: status.state === 'unsupported' ? 'idle' : status.state,
    });

    if (runImmediateCheck) {
      checkForUpdates('startup');
    }
  };

  const maybePromptForRestart = async () => {
    const [mainWindow] = deps.getAllWindows();
    if (!mainWindow) return;

    try {
      const detailParts: string[] = [];
      if (status.releaseName) {
        detailParts.push(status.releaseName);
      }
      if (status.releaseNotes) {
        detailParts.push('');
        detailParts.push(status.releaseNotes);
      }
      detailParts.push('');
      detailParts.push('Restart now to finish installing the update, or install it on the next launch.');

      const result = await deps.dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: 'A new version of iKi has been downloaded.',
        detail: detailParts.join('\n'),
      });
      if (result.response === 0) {
        deps.autoUpdater.quitAndInstall();
      }
    } catch (error) {
      deps.logger.event({
        level: 'warn',
        event: 'app_update.prompt',
        outcome: 'failed',
        error,
        message: 'Failed to present the restart-for-update prompt.',
      });
    }
  };

  const attachListeners = () => {
    deps.autoUpdater.on('checking-for-update', () => {
      setStatus({
        state: 'checking',
        error: null,
      });
    });

    deps.autoUpdater.on('update-available', () => {
      setStatus({
        state: 'downloading',
        error: null,
      });
      deps.logger.event({
        level: 'info',
        event: 'app_update.available',
        message: 'Application update found; downloading now.',
      });
    });

    deps.autoUpdater.on('update-not-available', () => {
      finishCheck({
        state: 'up-to-date',
        releaseName: null,
        releaseDate: null,
        releaseNotes: null,
        updateUrl: null,
        error: null,
      });
      deps.logger.event({
        level: 'info',
        event: 'app_update.check',
        outcome: 'succeeded',
        message: 'Application is already up to date.',
      });
    });

    deps.autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName, releaseDate, updateURL) => {
      finishCheck({
        state: 'downloaded',
        releaseName: releaseName || null,
        releaseDate: releaseDate instanceof Date ? releaseDate.toISOString() : null,
        releaseNotes: releaseNotes || null,
        updateUrl: updateURL || null,
        error: null,
      });
      deps.logger.event({
        level: 'info',
        event: 'app_update.downloaded',
        outcome: 'succeeded',
        message: 'Application update downloaded and ready to install.',
        data: {
          release_name: releaseName || null,
          update_url: updateURL || null,
        },
      });
      void maybePromptForRestart();
    });

    deps.autoUpdater.on('error', error => {
      finishCheck({
        state: 'error',
        error: error instanceof Error ? error.message : 'Update check failed.',
      });
      deps.logger.event({
        level: 'error',
        event: 'app_update.check',
        outcome: 'failed',
        error,
        message: 'Application update check failed.',
      });
    });
  };

  return {
    start(config: AppConfig) {
      autoUpdateEnabled = Boolean(config.general.autoUpdate);
      if (!started) {
        attachListeners();
        started = true;
      }

      scheduleAutomaticChecks(true);
    },
    applyConfig(config: AppConfig) {
      const previous = autoUpdateEnabled;
      autoUpdateEnabled = Boolean(config.general.autoUpdate);

      if (!started) {
        status = {
          ...status,
          autoUpdateEnabled,
          currentVersion: deps.app.getVersion(),
        };
        return;
      }

      if (autoUpdateEnabled !== previous) {
        scheduleAutomaticChecks(autoUpdateEnabled);
        return;
      }

      setStatus({
        autoUpdateEnabled,
      });
    },
    getStatus(): AppUpdateStatus {
      if (!feedUrl && status.state !== 'unsupported') {
        ensureFeedUrl();
      }
      return { ...status };
    },
    checkForUpdates(): AppUpdateStatus {
      return checkForUpdates('manual');
    },
    installUpdate(): void {
      if (status.state !== 'downloaded') {
        throw new Error('No downloaded update is ready to install.');
      }
      deps.autoUpdater.quitAndInstall();
    },
  };
};

const service = createAppUpdateService({
  app,
  autoUpdater,
  dialog,
  getAllWindows: () => getAllBrowserWindows(),
  logger: createLogger({ module: 'app_update_service' }),
  platform: process.platform,
  arch: process.arch,
  argv: process.argv,
  env: process.env,
  setIntervalFn: setInterval,
  clearIntervalFn: clearInterval,
  readFileSync: fs.readFileSync,
});

export const startAppUpdateService = (config: AppConfig): void => {
  service.start(config);
};

export const applyAppUpdateConfig = (config: AppConfig): void => {
  service.applyConfig(config);
};

export const getAppUpdateStatus = (): AppUpdateStatus => service.getStatus();

export const checkForAppUpdates = (): AppUpdateStatus => service.checkForUpdates();

export const installDownloadedAppUpdate = (): void => {
  service.installUpdate();
};
