import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __IKI_CLI_VERSION__: string | undefined;
declare const __IKI_NPM_PACKAGE__: string | undefined;

const DEFAULT_NPM_PACKAGE = '@irorange27/iki';
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';
const UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000;
const BACKGROUND_TIMEOUT_MS = 2500;
const EXPLICIT_TIMEOUT_MS = 8000;

type CliInstallSource = 'npm' | 'pnpm' | 'bun' | 'source';

type CliUpdateNotice = {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  checkedAt: number;
};

type CachedUpdateState = {
  packageName: string;
  latestVersion: string;
  checkedAt: number;
};

const readNearestPackageVersion = (): string => {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* ignore fallback read errors */
  }
  return '0.0.0';
};

export const resolveCliVersion = (): string =>
  typeof __IKI_CLI_VERSION__ === 'string' && __IKI_CLI_VERSION__.trim()
    ? __IKI_CLI_VERSION__.trim()
    : readNearestPackageVersion();

const resolveCliPackageName = (): string =>
  typeof __IKI_NPM_PACKAGE__ === 'string' && __IKI_NPM_PACKAGE__.trim()
    ? __IKI_NPM_PACKAGE__.trim()
    : DEFAULT_NPM_PACKAGE;

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const parseSemver = (raw: string): ParsedSemver | null => {
  const cleaned = raw.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(cleaned);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4] ? match[4].split('.') : [],
  };
};

/** Returns >0 if a > b, <0 if a < b, 0 if equal (or unparseable). */
const compareSemver = (a: string, b: string): number => {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    if (ia === ib) continue;
    const na = /^\d+$/.test(ia) ? Number.parseInt(ia, 10) : null;
    const nb = /^\d+$/.test(ib) ? Number.parseInt(ib, 10) : null;
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return ia < ib ? -1 : 1;
  }
  return 0;
};

const isNewerVersion = (latest: string, current: string): boolean =>
  compareSemver(latest, current) > 0;

const detectCliInstallSource = (argv1 = process.argv[1] ?? ''): CliInstallSource => {
  let resolved = argv1;
  try {
    if (argv1 && fs.existsSync(argv1)) resolved = fs.realpathSync(argv1);
  } catch {
    /* keep raw path */
  }
  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.includes('/packages/cli/src/') ||
    normalized.endsWith('/packages/cli/dist/iki.mjs')
  ) {
    return 'source';
  }
  if (normalized.includes('/.bun/')) return 'bun';
  if (normalized.includes('/pnpm/') || normalized.includes('/.pnpm')) return 'pnpm';
  return 'npm';
};

const formatUpgradeCommand = (
  source: CliInstallSource,
  packageName: string
): { command: string; args: string[]; display: string } => {
  const spec = `${packageName}@latest`;
  if (source === 'pnpm') {
    return { command: 'pnpm', args: ['add', '-g', spec], display: `pnpm add -g ${spec}` };
  }
  if (source === 'bun') {
    return { command: 'bun', args: ['add', '-g', spec], display: `bun add -g ${spec}` };
  }
  return { command: 'npm', args: ['install', '-g', spec], display: `npm install -g ${spec}` };
};

const updateCachePath = (dataDir: string): string =>
  path.join(dataDir, 'state', 'cli_update_check.json');

const readUpdateCache = (dataDir: string): CachedUpdateState | null => {
  try {
    const raw = JSON.parse(fs.readFileSync(updateCachePath(dataDir), 'utf8')) as Partial<CachedUpdateState>;
    if (
      typeof raw.packageName === 'string' &&
      typeof raw.latestVersion === 'string' &&
      typeof raw.checkedAt === 'number'
    ) {
      return {
        packageName: raw.packageName,
        latestVersion: raw.latestVersion,
        checkedAt: raw.checkedAt,
      };
    }
  } catch {
    /* missing or corrupt cache is harmless */
  }
  return null;
};

const writeUpdateCache = (dataDir: string, state: CachedUpdateState): void => {
  try {
    const file = updateCachePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore non-fatal cache write errors */
  }
};

const fetchLatestNpmVersion = async (options?: {
  packageName?: string;
  registryUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ version: string | null; error?: string }> => {
  const pkg = options?.packageName ?? resolveCliPackageName();
  const registry = (options?.registryUrl ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, '');
  const fetchFn = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? EXPLICIT_TIMEOUT_MS;
  const url = `${registry}/${encodeURIComponent(pkg)}/latest`;

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { version: null, error: `HTTP ${res.status} from ${registry}` };
    }
    const payload = (await res.json()) as { version?: unknown };
    if (typeof payload?.version === 'string' && payload.version.trim()) {
      return { version: payload.version.trim() };
    }
    return { version: null, error: 'Registry response did not include a version field' };
  } catch (err) {
    return {
      version: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/** Synchronously reads a cached update notice (0ms network latency on startup). */
export const readCachedUpdateNotice = (params: {
  dataDir: string;
  currentVersion?: string;
  packageName?: string;
}): CliUpdateNotice | null => {
  const currentVersion = params.currentVersion ?? resolveCliVersion();
  const packageName = params.packageName ?? resolveCliPackageName();
  const cached = readUpdateCache(params.dataDir);
  if (!cached || cached.packageName !== packageName) return null;
  if (!isNewerVersion(cached.latestVersion, currentVersion)) return null;
  return {
    packageName,
    currentVersion,
    latestVersion: cached.latestVersion,
    checkedAt: cached.checkedAt,
  };
};

/**
 * Fires a silent, non-blocking background registry check when the 12-hour cache is stale.
 */
export const scheduleBackgroundUpdateCheck = (params: {
  dataDir: string;
  enabled?: boolean;
  packageName?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> => {
  const env = params.env ?? process.env;
  if (params.enabled === false) return Promise.resolve(false);
  if (env.IKI_NO_UPDATE_CHECK === '1' || env.IKI_NO_UPDATE_CHECK === 'true') {
    return Promise.resolve(false);
  }
  if (env.CI === 'true' || env.CI === '1') return Promise.resolve(false);

  const packageName = params.packageName ?? resolveCliPackageName();
  const now = params.now ?? Date.now();
  const cached = readUpdateCache(params.dataDir);
  if (cached && cached.packageName === packageName && now - cached.checkedAt < UPDATE_CHECK_TTL_MS) {
    return Promise.resolve(false);
  }

  return fetchLatestNpmVersion({
    packageName,
    timeoutMs: BACKGROUND_TIMEOUT_MS,
    fetchImpl: params.fetchImpl,
  })
    .then(result => {
      if (!result.version) return false;
      writeUpdateCache(params.dataDir, {
        packageName,
        latestVersion: result.version,
        checkedAt: now,
      });
      return true;
    })
    .catch(() => false);
};

export const runCliUpdateCommand = async (params: {
  dataDir: string;
  checkOnly?: boolean;
  packageName?: string;
  currentVersion?: string;
  argv1?: string;
  fetchImpl?: typeof fetch;
  runInstall?: (command: string, args: string[]) => number;
  write?: (line: string) => void;
}): Promise<number> => {
  const packageName = params.packageName ?? resolveCliPackageName();
  const currentVersion = params.currentVersion ?? resolveCliVersion();
  const write = params.write ?? ((line: string) => console.log(line));

  write(`Checking ${packageName} for updates (current: v${currentVersion})...`);
  const result = await fetchLatestNpmVersion({
    packageName,
    timeoutMs: EXPLICIT_TIMEOUT_MS,
    fetchImpl: params.fetchImpl,
  });

  if (!result.version) {
    write(`Could not check updates for ${packageName}: ${result.error ?? 'unknown error'}`);
    return 1;
  }

  writeUpdateCache(params.dataDir, {
    packageName,
    latestVersion: result.version,
    checkedAt: Date.now(),
  });

  if (!isNewerVersion(result.version, currentVersion)) {
    write(`iki v${currentVersion} is already up to date (latest: v${result.version}).`);
    return 0;
  }

  const installSource = detectCliInstallSource(params.argv1);
  const upgrade = formatUpgradeCommand(installSource, packageName);

  if (params.checkOnly) {
    write(
      `Update available: v${currentVersion} → v${result.version}\n` +
        (installSource === 'source'
          ? 'Running from local source checkout. Update with: git pull && pnpm cli:build'
          : `Run \`iki update\` or \`${upgrade.display}\` to upgrade.`)
    );
    return 0;
  }

  if (installSource === 'source') {
    write(
      `Update available: v${currentVersion} → v${result.version}\n` +
        'Running from local source checkout; skipping global npm install.\n' +
        'Update with: git pull && pnpm cli:build'
    );
    return 0;
  }

  write(`Updating ${packageName}: v${currentVersion} → v${result.version} (${upgrade.display})...`);
  const exitCode = params.runInstall
    ? params.runInstall(upgrade.command, upgrade.args)
    : (spawnSync(upgrade.command, upgrade.args, { stdio: 'inherit' }).status ?? 1);

  if (exitCode !== 0) {
    write(`Update failed (exit code ${exitCode}). Try running manually:\n  ${upgrade.display}`);
    return exitCode;
  }

  write(`Updated iki to v${result.version}.`);
  return 0;
};
