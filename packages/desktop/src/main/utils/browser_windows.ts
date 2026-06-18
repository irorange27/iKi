import { BrowserWindow } from 'electron';

export const getAllBrowserWindows = (): BrowserWindow[] => {
  if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') {
    return [];
  }

  try {
    const windows = BrowserWindow.getAllWindows();
    return Array.isArray(windows) ? windows : [];
  } catch {
    return [];
  }
};
