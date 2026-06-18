import { addClipboardSnapshot, pruneClipboardSnapshots, listRecentClipboardSnapshots } from '@iki/core/db/clipboard';

const POLL_INTERVAL_MS = 2_000;
const MAX_SNAPSHOTS = 200;

type ClipboardMonitorState = {
  lastContent: string;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
};

let state: ClipboardMonitorState = {
  lastContent: '',
  timer: null,
  running: false,
};

const readClipboardText = (): string => {
  try {
    const { clipboard } = require('electron');
    return clipboard.readText() || '';
  } catch {
    return '';
  }
};

const tick = (): void => {
  try {
    const current = readClipboardText();
    if (!current || current === state.lastContent) return;
    state.lastContent = current;

    addClipboardSnapshot({ content: current });
    pruneClipboardSnapshots(MAX_SNAPSHOTS);
  } catch {
    // clipboard read may fail in headless or sandboxed environments
  }
};

export const startClipboardMonitor = (): void => {
  if (state.running) return;
  state.lastContent = readClipboardText();
  state.timer = setInterval(tick, POLL_INTERVAL_MS);
  state.running = true;
};

export const stopClipboardMonitor = (): void => {
  if (!state.running || !state.timer) return;
  clearInterval(state.timer);
  state.timer = null;
  state.running = false;
};

export const isClipboardMonitorRunning = (): boolean => state.running;

export const getClipboardContextMessage = (maxEntries = 10): string => {
  const entries = listRecentClipboardSnapshots(maxEntries);
  if (entries.length === 0) return '';

  const lines = entries.map(
    (entry) =>
      `[${entry.captured_at.slice(11, 19)}] ${entry.content_preview}`
  );

  return [
    'Recent clipboard activity (user may be working with this content):',
    ...lines,
  ].join('\n');
};
