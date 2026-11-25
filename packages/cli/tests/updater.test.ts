import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readCachedUpdateNotice,
  resolveCliVersion,
  runCliUpdateCommand,
  scheduleBackgroundUpdateCheck,
} from '../src/updater';

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const makeMockFetch = (version: string | null, status = 200): typeof fetch =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => (version ? { version } : {}),
    }) as Response) as typeof fetch;

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI self-update & cached background version checks', () => {
  it('resolves CLI version from package.json and respects 12h cache + semver comparison', async () => {
    expect(resolveCliVersion()).toMatch(/^\d+\.\d+\.\d+/);

    const dataDir = makeTempDir('iki-upd-cache-');
    let fetchCalls = 0;
    const mockFetch: typeof fetch = (async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: '0.2.0' }),
      } as Response;
    }) as typeof fetch;

    // Opt-out via env var skips network call completely
    expect(
      await scheduleBackgroundUpdateCheck({
        dataDir,
        env: { IKI_NO_UPDATE_CHECK: '1' },
        fetchImpl: mockFetch,
      })
    ).toBe(false);
    expect(fetchCalls).toBe(0);

    // First background check populates cache
    const t0 = 1_700_000_000_000;
    expect(
      await scheduleBackgroundUpdateCheck({
        dataDir,
        env: {},
        now: t0,
        fetchImpl: mockFetch,
      })
    ).toBe(true);
    expect(fetchCalls).toBe(1);

    // Within 12h TTL, skips network call
    expect(
      await scheduleBackgroundUpdateCheck({
        dataDir,
        env: {},
        now: t0 + 60_000,
        fetchImpl: mockFetch,
      })
    ).toBe(false);
    expect(fetchCalls).toBe(1);

    // Notice shown for older & prerelease versions, suppressed for same/newer versions
    expect(readCachedUpdateNotice({ dataDir, currentVersion: '0.1.1' })?.latestVersion).toBe('0.2.0');
    expect(readCachedUpdateNotice({ dataDir, currentVersion: '0.2.0-alpha.1' })?.latestVersion).toBe('0.2.0');
    expect(readCachedUpdateNotice({ dataDir, currentVersion: '0.2.0' })).toBeNull();
    expect(readCachedUpdateNotice({ dataDir, currentVersion: '0.3.0' })).toBeNull();
  });

  it('runs iki update across --check, up-to-date, source checkout, and global npm/pnpm installs', async () => {
    const dataDir = makeTempDir('iki-upd-cmd-');

    // Up to date
    const upToDateLines: string[] = [];
    const upCode = await runCliUpdateCommand({
      dataDir,
      currentVersion: '0.2.0',
      fetchImpl: makeMockFetch('0.2.0'),
      write: line => upToDateLines.push(line),
    });
    expect(upCode).toBe(0);
    expect(upToDateLines.join('\n')).toContain('already up to date');

    // --check only does not invoke installer
    const checkLines: string[] = [];
    let installed = false;
    const checkCode = await runCliUpdateCommand({
      dataDir,
      checkOnly: true,
      currentVersion: '0.1.1',
      argv1: '/usr/local/lib/node_modules/@irorange27/iki/bin/iki.mjs',
      fetchImpl: makeMockFetch('0.1.2'),
      runInstall: () => {
        installed = true;
        return 0;
      },
      write: line => checkLines.push(line),
    });
    expect(checkCode).toBe(0);
    expect(installed).toBe(false);
    expect(checkLines.join('\n')).toContain('v0.1.1 → v0.1.2');

    // Local source checkout avoids clobbering global npm
    const srcLines: string[] = [];
    const srcCode = await runCliUpdateCommand({
      dataDir,
      currentVersion: '0.1.1',
      argv1: '/Users/dev/iki/packages/cli/src/main.ts',
      fetchImpl: makeMockFetch('0.1.2'),
      runInstall: () => {
        installed = true;
        return 0;
      },
      write: line => srcLines.push(line),
    });
    expect(srcCode).toBe(0);
    expect(installed).toBe(false);
    expect(srcLines.join('\n')).toContain('git pull && pnpm cli:build');

    // Global pnpm install picks `pnpm add -g @irorange27/iki@latest`
    let capturedCmd = '';
    let capturedArgs: string[] = [];
    const pnpmCode = await runCliUpdateCommand({
      dataDir,
      currentVersion: '0.1.1',
      argv1: '/Users/dev/.local/share/pnpm/global/5/node_modules/@irorange27/iki/bin/iki.mjs',
      fetchImpl: makeMockFetch('0.1.2'),
      runInstall: (cmd, args) => {
        capturedCmd = cmd;
        capturedArgs = args;
        return 0;
      },
      write: () => {},
    });
    expect(pnpmCode).toBe(0);
    expect(capturedCmd).toBe('pnpm');
    expect(capturedArgs).toEqual(['add', '-g', '@irorange27/iki@latest']);

    // Registry 404 returns non-zero cleanly
    const errLines: string[] = [];
    const errCode = await runCliUpdateCommand({
      dataDir,
      currentVersion: '0.1.1',
      fetchImpl: makeMockFetch(null, 404),
      write: line => errLines.push(line),
    });
    expect(errCode).toBe(1);
    expect(errLines.join('\n')).toContain('HTTP 404');
  });
});
