import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';

export const VITE_EXTERNAL_RUNTIME_DEPS = [
  'better-sqlite3',
  'whisper-node',
  'ffmpeg-static',
] as const;

type PackageLockPackage = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type PackageLock = {
  packages?: Record<string, PackageLockPackage>;
};

type RuntimePackageRule = {
  include: string[];
  unpack?: string[];
};

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

const resolveRealPath = (value: string): string => {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
};

const readPackageLockPackages = (projectDir: string): Record<string, PackageLockPackage> => {
  try {
    const lockPath = path.join(projectDir, 'package-lock.json');
    if (!fs.existsSync(lockPath)) return {};
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as PackageLock;
    return parsed.packages ?? {};
  } catch {
    return {};
  }
};

const resolveInstalledPackagePath = (
  projectDir: string,
  packageName: string,
  fromDir = projectDir
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

const extractPackageName = (specifier: string): string | null => {
  const trimmed = specifier.trim();
  if (!trimmed || trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('node:')) {
    return null;
  }

  if (trimmed.startsWith('@')) {
    const [scope, name] = trimmed.split('/');
    if (!scope || !name) return null;
    return `${scope}/${name}`;
  }

  const [name] = trimmed.split('/');
  return name || null;
};

const BUILTIN_MODULE_SET = new Set(
  builtinModules.flatMap(moduleName => [moduleName, moduleName.replace(/^node:/, '')])
);

const isBuiltinSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith('node:')) return true;
  if (BUILTIN_MODULE_SET.has(specifier)) return true;
  const packageName = extractPackageName(specifier);
  return packageName ? BUILTIN_MODULE_SET.has(packageName) : false;
};

const collectBuiltRuntimePackageNames = (projectDir: string): string[] => {
  const buildDir = path.join(projectDir, '.vite', 'build');
  if (!fs.existsSync(buildDir)) return [];

  const entryFiles = fs
    .readdirSync(buildDir)
    .filter(fileName => fileName === 'index.js' || /^main(?:-[^.]+)?\.js$/.test(fileName));

  const runtimePackages = new Set<string>();
  const requirePattern = /require\((['"])([^'"]+)\1\)/g;

  for (const fileName of entryFiles) {
    const filePath = path.join(buildDir, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = requirePattern.exec(source))) {
      const specifier = match[2];
      if (!specifier || isBuiltinSpecifier(specifier)) continue;
      const packageName = extractPackageName(specifier);
      if (!packageName) continue;
      runtimePackages.add(packageName);
    }
  }

  return Array.from(runtimePackages).sort();
};

const getWhisperBinaryName = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? 'main.exe' : 'main';

const getFfmpegBinaryName = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

const getRuntimePackageRules = (platform: NodeJS.Platform): Record<string, RuntimePackageRule> => ({
  'better-sqlite3': {
    include: ['package.json', 'lib', 'build/Release'],
    unpack: ['build/Release/better_sqlite3.node'],
  },
  bindings: {
    include: [''],
  },
  'file-uri-to-path': {
    include: [''],
  },
  'ffmpeg-static': {
    include: ['package.json', 'index.js', getFfmpegBinaryName(platform)],
    unpack: [getFfmpegBinaryName(platform)],
  },
  'whisper-node': {
    include: ['package.json', `lib/whisper.cpp/${getWhisperBinaryName(platform)}`],
    unpack: [`lib/whisper.cpp/${getWhisperBinaryName(platform)}`],
  },
});

const resolveRuntimeDependencyPackagePaths = (
  projectDir: string,
  packageNames: readonly string[]
): string[] => {
  const lockPackages = readPackageLockPackages(projectDir);
  const visited = new Set<string>();
  const queue = packageNames
    .map(packageName => resolveInstalledPackagePath(projectDir, packageName))
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
      const dependencyPath = resolveInstalledPackagePath(projectDir, dependencyName, fromDir);

      if (dependencyPath && !visited.has(dependencyPath)) {
        queue.push(dependencyPath);
      }
    }
  }

  return Array.from(visited).sort();
};

const resolveRuntimeRulePaths = (
  projectDir: string,
  ruleType: keyof RuntimePackageRule,
  platform: NodeJS.Platform = process.platform
): string[] => {
  const rules = getRuntimePackageRules(platform);
  const resolvedPaths = new Set<string>();

  for (const [packageName, rule] of Object.entries(rules)) {
    const packagePath = resolveInstalledPackagePath(projectDir, packageName);
    if (!packagePath) continue;

    for (const relativeIncludePath of rule[ruleType] ?? []) {
      const candidatePath = relativeIncludePath
        ? normalizePath(path.posix.join(packagePath, relativeIncludePath))
        : packagePath;
      const absolutePath = path.join(projectDir, candidatePath);
      if (!fs.existsSync(absolutePath)) continue;
      resolvedPaths.add(candidatePath);
    }
  }

  return Array.from(resolvedPaths).sort();
};

export const resolveRuntimePackagingPaths = (
  projectDir: string,
  platform: NodeJS.Platform = process.platform
): string[] => {
  const rulePaths = resolveRuntimeRulePaths(projectDir, 'include', platform);
  const specialPackages = new Set(Object.keys(getRuntimePackageRules(platform)));
  const detectedPackages = collectBuiltRuntimePackageNames(projectDir).filter(
    packageName => !specialPackages.has(packageName)
  );
  const dependencyPackagePaths = resolveRuntimeDependencyPackagePaths(projectDir, detectedPackages);

  return Array.from(new Set([...rulePaths, ...dependencyPackagePaths])).sort();
};

export const resolveRuntimeUnpackPaths = (
  projectDir: string,
  platform: NodeJS.Platform = process.platform
): string[] => resolveRuntimeRulePaths(projectDir, 'unpack', platform);

const shouldIncludePath = (candidatePath: string, allowedPrefixes: readonly string[]): boolean =>
  allowedPrefixes.some(
    allowedPrefix =>
      candidatePath === allowedPrefix ||
      candidatePath.startsWith(`${allowedPrefix}/`) ||
      allowedPrefix.startsWith(`${candidatePath}/`)
  );

export const createVitePackagingIgnore = (
  projectDir: string,
  platform: NodeJS.Platform = process.platform
): ((file: string) => boolean) => {
  let allowedPrefixes: string[] | null = null;

  return (file: string): boolean => {
    if (!file) return false;

    if (!allowedPrefixes) {
      const runtimePackagePaths = resolveRuntimePackagingPaths(projectDir, platform);
      allowedPrefixes = ['/.vite', ...runtimePackagePaths.map(packagePath => `/${packagePath}`)];
    }

    const candidatePath = normalizePath(file);
    if (candidatePath === '/package.json') return false;

    return !shouldIncludePath(candidatePath, allowedPrefixes);
  };
};

export const createRuntimeAsarConfig = (
  projectDir: string,
  platform: NodeJS.Platform = process.platform
): true | { unpack?: string } => {
  const unpackPaths = resolveRuntimeUnpackPaths(projectDir, platform);
  if (unpackPaths.length === 0) return true;
  return {
    unpack: `{${unpackPaths.map(unpackPath => `**/${unpackPath}`).join(',')}}`,
  };
};
