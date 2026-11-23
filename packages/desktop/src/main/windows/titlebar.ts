import os from 'node:os';
import type { BrowserWindowConstructorOptions } from 'electron';

export type StandardWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'frame' | 'titleBarStyle' | 'trafficLightPosition'
>;

// Tahoe+ (Darwin >= 25) enlarged the window corner radius and native traffic
// lights (~14px vs 12px on Sequoia). Shifting 1px inward keeps the close button
// center at (26, 26) across both generations so the topbar centerline stays fixed.
const TAHOE_DARWIN_MAJOR = 25;

const resolveMacTrafficLightPosition = (
  darwinRelease: string = os.release()
): { x: number; y: number } => {
  const major = Number.parseInt(darwinRelease.split('.')[0] ?? '', 10);
  if (Number.isFinite(major) && major >= TAHOE_DARWIN_MAJOR) {
    return { x: 19, y: 19 };
  }
  return { x: 20, y: 20 };
};

/**
 * Returns native window chrome options shared by standard desktop windows.
 * Uses `hiddenInset` with native macOS traffic lights so Sequoia and Tahoe+
 * render system-authentic button geometry, hover menus, and focus dimming.
 */
export const resolveStandardWindowChromeOptions = (
  platform: NodeJS.Platform = process.platform,
  darwinRelease: string = os.release()
): StandardWindowChromeOptions => {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: resolveMacTrafficLightPosition(darwinRelease),
    };
  }
  return {
    frame: false,
  };
};
