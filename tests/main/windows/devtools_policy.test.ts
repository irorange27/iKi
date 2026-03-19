import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

import {
  maybeOpenDevTools,
  parseBooleanEnv,
  shouldAutoOpenDevTools,
} from '../../../src/main/windows/devtools_policy';

describe('devtools policy', () => {
  it('parses supported boolean env values', () => {
    expect(parseBooleanEnv('1')).toBe(true);
    expect(parseBooleanEnv('true')).toBe(true);
    expect(parseBooleanEnv(' YES ')).toBe(true);
    expect(parseBooleanEnv('on')).toBe(true);

    expect(parseBooleanEnv('0')).toBe(false);
    expect(parseBooleanEnv('false')).toBe(false);
    expect(parseBooleanEnv(' no ')).toBe(false);
    expect(parseBooleanEnv('off')).toBe(false);
  });

  it('returns null for unsupported env values', () => {
    expect(parseBooleanEnv(undefined)).toBeNull();
    expect(parseBooleanEnv('')).toBeNull();
    expect(parseBooleanEnv('open')).toBeNull();
  });

  it('keeps auto-open disabled by default in development', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: false,
        autoOpenEnv: undefined,
      })
    ).toBe(false);
  });

  it('supports explicit opt-in in development', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: false,
        autoOpenEnv: 'true',
      })
    ).toBe(true);
  });

  it('always disables auto-open in packaged builds', () => {
    expect(
      shouldAutoOpenDevTools({
        isPackaged: true,
        autoOpenEnv: 'true',
      })
    ).toBe(false);
  });

  it('opens devtools only when policy allows', () => {
    const webContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      openDevTools: vi.fn(),
    } satisfies Pick<WebContents, 'isDestroyed' | 'openDevTools'>;

    maybeOpenDevTools(webContents as WebContents, {
      isPackaged: false,
      autoOpenEnv: 'true',
    });
    expect(webContents.openDevTools).toHaveBeenCalledTimes(1);

    maybeOpenDevTools(webContents as WebContents, {
      isPackaged: false,
      autoOpenEnv: 'false',
    });
    expect(webContents.openDevTools).toHaveBeenCalledTimes(1);
  });
});
