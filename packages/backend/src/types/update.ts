export type AppUpdateState =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

export type AppUpdateUnsupportedReason =
  | 'platform'
  | 'not-packaged'
  | 'first-run'
  | 'repository-unavailable';

export interface AppUpdateStatus {
  state: AppUpdateState;
  autoUpdateEnabled: boolean;
  supported: boolean;
  checkIntervalMs: number | null;
  currentVersion: string;
  lastCheckedAt: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  updateUrl: string | null;
  error: string | null;
  unsupportedReason: AppUpdateUnsupportedReason | null;
}
