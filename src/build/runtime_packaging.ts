import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

type PackageLockPackage = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type PackageLock = {
  packages?: Record<string, PackageLockPackage>;
};

export const VITE_EXTERNAL_RUNTIME_DEPS = [
  'better-sqlite3',
  'whisper-node',
  'ffmpeg-static',
  'shelljs',
  'readline-sync',
] as const;

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

const resolveRealPath = (value: string): string => {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
};

const readPackageLockPackages = (projectDir: string): Record<string, PackageLockPackage> => {
  const lockPath = path.join(projectDir, 'package-lock.json');
  const raw = fs.readFileSync(lockPath, 'utf8');
  const parsed = JSON.parse(raw) as PackageLock;
  return parsed.packages ?? {};
};

const resolveInstalledPackagePath = (
  projectDir: string,
  fromDir: string,
  packageName: string
): string | null => {
  try {
    const resolvedProjectDir = resolveRealPath(projectDir);
    const resolvedFromDir = resolveRealPath(fromDir);
    const resolver = createRequire(path.join(resolvedFromDir, '__runtime_packaging__.cjs'));
    const packageJsonPath = resolver.resolve(`${packageName}/package.json`);
    const packageDir = resolveRealPath(path.dirname(packageJsonPath));
    const relativePath = normalizePath(path.relative(resolvedProjectDir, packageDir));

    if (!relativePath || relativePath.startsWith('..')) {
      return null;
    }

    return relativePath;
  } catch {
    return null;
  }
};

export const resolveRuntimeDependencyPackagePaths = (
  projectDir: string,
  packageNames: readonly string[] = VITE_EXTERNAL_RUNTIME_DEPS
): string[] => {
  const lockPackages = readPackageLockPackages(projectDir);
  const visited = new Set<string>();
  const queue = packageNames
    .map(packageName => resolveInstalledPackagePath(projectDir, projectDir, packageName))
    .filter((value): value is string => Boolean(value));

  while (queue.length > 0) {
    const packagePath = queue.shift();
    if (!packagePath || visited.has(packagePath)) continue;

    visited.add(packagePath);

    const lockEntry = lockPackages[packagePath];
    const dependencyNames = new Set<string>([
      ...Object.keys(lockEntry?.dependencies ?? {}),
      ...Object.keys(lockEntry?.optionalDependencies ?? {}),
    ]);

    for (const dependencyName of dependencyNames) {
      const fromDir = path.join(projectDir, packagePath);
      const dependencyPath = resolveInstalledPackagePath(projectDir, fromDir, dependencyName);

      if (dependencyPath && !visited.has(dependencyPath)) {
        queue.push(dependencyPath);
      }
    }
  }

  return Array.from(visited).sort();
};

const shouldIncludePath = (candidatePath: string, allowedPrefixes: readonly string[]): boolean =>
  allowedPrefixes.some(
    allowedPrefix =>
      candidatePath === allowedPrefix ||
      candidatePath.startsWith(`${allowedPrefix}/`) ||
      allowedPrefix.startsWith(`${candidatePath}/`)
  );

export const createVitePackagingIgnore = (
  projectDir: string,
  packageNames: readonly string[] = VITE_EXTERNAL_RUNTIME_DEPS
): ((file: string) => boolean) => {
  const runtimePackagePaths = resolveRuntimeDependencyPackagePaths(projectDir, packageNames);
  const allowedPrefixes = ['/.vite', ...runtimePackagePaths.map(packagePath => `/${packagePath}`)];

  return (file: string): boolean => {
    if (!file) return false;

    const candidatePath = normalizePath(file);
    if (candidatePath === '/package.json') return false;

    return !shouldIncludePath(candidatePath, allowedPrefixes);
  };
};
