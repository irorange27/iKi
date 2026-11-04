// Shared renderer formatting helpers. One implementation per concern; UI
// components and composables import from here instead of re-rolling.

export const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export const formatRelativeTime = (iso: string, translate: TranslateFn): string => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const diff = Date.now() - time;
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  if (diff < MINUTE) return translate('time.justNow');
  if (diff < HOUR) return translate('time.minutes', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return translate('time.hours', { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return translate('time.days', { count: Math.floor(diff / DAY) });
  return new Date(time).toLocaleDateString();
};

// Covers sub-second spans ("350ms"), one-decimal seconds ("3.5s") and
// minute+second spans ("2m 05s").
export const formatDuration = (ms: number | null): string => {
  if (ms === null) return '…';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};

export const formatCompactNumber = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const rounded = Math.max(0, Math.round(value));
  const trim = (text: string) => text.replace(/\.0$/, '');
  if (rounded >= 1_000_000) return `${trim((rounded / 1_000_000).toFixed(1))}M`;
  if (rounded >= 1_000) return `${trim((rounded / 1_000).toFixed(1))}K`;
  return String(rounded);
};

export const formatBytes = (value?: number): string => {
  if (typeof value !== 'number' || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
};
