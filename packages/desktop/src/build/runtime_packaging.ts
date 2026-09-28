import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';

export const VITE_EXTERNAL_RUNTIME_DEPS = [
  'whisper-node',
  'ffmpeg-static',
  // ponytail: otel/langfuse pulled in a process-introspection path that crashed Vite's CJS interop; load at runtime instead.
  '@langfuse/otel',
  '@langfuse/tracing',
  '@opentelemetry/api',
  '@opentelemetry/sdk-node',
] as const;

type InstalledPackageManifest = {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** A runtime package to copy into the packaged app: realpath source → app-relative destination. */
export type RuntimePlacement = {
  sourcePath: string;
  targetRelative: string;
};

export type RuntimePackagingPlan = {
  placements: RuntimePlacement[];
  unpackPaths: string[];
};

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

const resolveRealPath = (value: string): string => {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
};

const readInstalledPackageManifest = (packageDir: string): InstalledPackageManifest => {
  try {
    const raw = fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8');
    return JSON.parse(raw) as InstalledPackageManifest;
  } catch {
    return {};
  }
};

/**
 * Resolve a package name to its installed real path (pnpm store, hoisted
 * node_modules, …) as seen from `fromDir`. Node's own resolution walks up the
 * directory tree, so packages declared in the monorepo root resolve fine even
 * though the packaging project dir is `packages/desktop`.
 *
 * `name/package.json` is not exported by every package (modern `exports`
 * maps), so fall back to resolving the bare entry and deriving the package
 * dir from the real path's last `node_modules/` segment.
 */
const resolvePackageRealPath = (fromDir: string, packageName: string): string | null => {
  const resolver = createRequire(path.join(resolveRealPath(fromDir), '__runtime_packaging__.cjs'));

  const packageDirFromFile = (resolvedFile: string): string | null => {
    const realFile = resolveRealPath(resolvedFile);
    const marker = `${path.sep}node_modules${path.sep}`;
    const markerIndex = realFile.lastIndexOf(marker);
    if (markerIndex === -1) return null;
    const nodeModulesRoot = realFile.slice(0, markerIndex + marker.length - 1);
    const remainder = realFile.slice(markerIndex + marker.length);
    const segments = remainder.split(path.sep);
    if (segments.length === 0 || !segments[0]) return null;
    // Scoped packages span two segments below node_modules.
    return segments[0].startsWith('@') && segments.length > 1
      ? path.join(nodeModulesRoot, segments[0], segments[1])
      : path.join(nodeModulesRoot, segments[0]);
  };

  try {
    return path.dirname(resolveRealPath(resolver.resolve(`${packageName}/package.json`)));
  } catch {
    try {
      return packageDirFromFile(resolver.resolve(packageName));
    } catch {
      return null;
    }
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

// `electron` resolves to Electron's builtin module inside the app runtime —
// never to the npm package, whose 800 MB dist must not be staged.
const RUNTIME_BUILTIN_MODULE_NAMES = ['electron'];

const BUILTIN_MODULE_SET = new Set(
  [...builtinModules, ...RUNTIME_BUILTIN_MODULE_NAMES].flatMap(moduleName => [
    moduleName,
    moduleName.replace(/^node:/, ''),
  ])
);

const isBuiltinSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith('node:')) return true;
  if (BUILTIN_MODULE_SET.has(specifier)) return true;
  const packageName = extractPackageName(specifier);
  return packageName ? BUILTIN_MODULE_SET.has(packageName) : false;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const addRuntimePackageFromSpecifier = (
  runtimePackages: Set<string>,
  specifier: string | undefined
) => {
  if (!specifier || isBuiltinSpecifier(specifier)) return;
  const packageName = extractPackageName(specifier);
  if (!packageName) return;
  runtimePackages.add(packageName);
};

const collectSpecifierMatches = (
  source: string,
  pattern: RegExp,
  runtimePackages: Set<string>
) => {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    addRuntimePackageFromSpecifier(runtimePackages, match[2]);
  }
};

const collectBuiltRuntimePackageNames = (projectDir: string): string[] => {
  const buildDir = path.join(projectDir, '.vite', 'build');
  if (!fs.existsSync(buildDir)) return [];

  const entryFiles = fs
    .readdirSync(buildDir)
    .filter(fileName => fileName === 'index.js' || /^main(?:-[^.]+)?\.js$/.test(fileName));

  const runtimePackages = new Set<string>();
  const requirePattern = /\brequire(?:\.resolve)?\((['"])([^'"]+)\1\)/g;
  const directCreateRequirePattern =
    /\bcreateRequire\s*\([^)]*\)(?:\s*\.resolve)?\((['"])([^'"]+)\1\)/g;
  const createRequireAliasPattern =
    /(?:^|[,(;])\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*[^,;\n]*\bcreateRequire\s*\(/g;

  for (const fileName of entryFiles) {
    const filePath = path.join(buildDir, fileName);
    const source = fs.readFileSync(filePath, 'utf8');

    collectSpecifierMatches(source, requirePattern, runtimePackages);
    collectSpecifierMatches(source, directCreateRequirePattern, runtimePackages);

    createRequireAliasPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = createRequireAliasPattern.exec(source))) {
      const aliasName = match[1];
      if (!aliasName) continue;
      const aliasPattern = new RegExp(
        `\\b${escapeRegExp(aliasName)}(?:\\s*\\.resolve)?\\((['"])([^'"]+)\\1\\)`,
        'g'
      );
      collectSpecifierMatches(source, aliasPattern, runtimePackages);
    }
  }

  return Array.from(runtimePackages).sort();
};

const getWhisperBinaryName = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? 'main.exe' : 'main';

const getFfmpegBinaryName = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

type RuntimePackageRule = {
  include: string[];
  unpack?: string[];
};

const getRuntimePackageRules = (platform: NodeJS.Platform): Record<string, RuntimePackageRule> => ({
  'ffmpeg-static': {
    include: ['package.json', 'index.js', getFfmpegBinaryName(platform)],
    unpack: [getFfmpegBinaryName(platform)],
  },
  'whisper-node': {
    include: ['package.json', `lib/whisper.cpp/${getWhisperBinaryName(platform)}`],
    unpack: [`lib/whisper.cpp/${getWhisperBinaryName(platform)}`],
  },
});

/**
 * Walk the transitive dependency closure of the runtime roots and map every
 * package to a destination inside the packaged app. Sources are the installed
 * real paths (typically the pnpm store outside the desktop project dir), so
 * the copier must materialise them — the packager can only archive files that
 * live under the app dir.
 *
 * Dependencies are placed npm-style nested under their consumer
 * (`node_modules/<consumer>/node_modules/<dep>`) whenever the consumer's
 * resolved real path differs from the copy already visible further up the
 * chain, reproducing pnpm's multi-version isolation with plain files only —
 * no symlinks inside the asar.
 */
export const resolveRuntimePackagingPlan = (
  projectDir: string,
  platform: NodeJS.Platform = process.platform
): RuntimePackagingPlan => {
  const specialRules = getRuntimePackageRules(platform);
  const roots = new Set<string>([
    ...VITE_EXTERNAL_RUNTIME_DEPS,
    ...collectBuiltRuntimePackageNames(projectDir),
  ]);

  // A package's install name and physical path together identify a node:
  // distinct store copies of the same name@version can carry different peer
  // contexts, while aliases can expose one physical path under two names.
  type ClosureNode = {
    key: string;
    name: string;
    version: string;
    realpath: string;
    depth: number;
  };

  const nodes = new Map<string, ClosureNode>();
  const edges = new Map<string, Set<string>>();

  const queue: Array<ClosureNode> = [];
  const enqueueNode = (name: string, realpath: string, depth: number): string | null => {
    const key = JSON.stringify([name, realpath]);
    const existing = nodes.get(key);
    if (existing) return existing.key;
    const manifest = readInstalledPackageManifest(realpath);
    const node: ClosureNode = {
      key,
      name,
      version: manifest.version ?? 'unknown',
      realpath,
      depth,
    };
    nodes.set(key, node);
    queue.push(node);
    return node.key;
  };

  for (const root of roots) {
    const rootRealPath = resolvePackageRealPath(projectDir, root);
    if (rootRealPath) enqueueNode(root, rootRealPath, 0);
  }
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    // Binary-drop packages ship only the files from their include rule — their
    // JS dependency closure (whisper's ML stack alone is hundreds of MB) never
    // loads inside the packaged app.
    if (specialRules[node.name]) continue;
    const manifest = readInstalledPackageManifest(node.realpath);
    const dependencyNames = new Set<string>([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    const childKeys = new Set<string>();
    for (const dependencyName of dependencyNames) {
      // Type-only packages exist for the compiler, never for `require` at runtime.
      if (dependencyName.startsWith('@types/')) continue;
      // The packaged app provides `electron` as a builtin module.
      if (dependencyName === 'electron') continue;
      const childRealPath = resolvePackageRealPath(node.realpath, dependencyName);
      if (!childRealPath) continue;
      const childKey = enqueueNode(dependencyName, childRealPath, node.depth + 1);
      if (childKey) childKeys.add(childKey);
    }
    if (childKeys.size > 0) edges.set(node.key, childKeys);
  }
  // Hoist the shallowest install of each name. Other installs go at the
  // shallowest safe resolution directory; a nearer conflicting install splits
  // consumers into separate scopes. This shares valid ancestors without
  // recursively copying every descendant into every branch.
  const MAX_RUNTIME_PACKAGE_PLACEMENTS = 2000;

  const depthSorted = Array.from(nodes.values()).sort(
    (left, right) => left.depth - right.depth || left.key.localeCompare(right.key)
  );
  const rootNodesByName = new Map<string, ClosureNode>();
  for (const node of depthSorted) {
    if (!rootNodesByName.has(node.name)) {
      rootNodesByName.set(node.name, node);
    }
  }

  // Every node_modules directory on a consumer target's resolution chain,
  // deepest first, always ending at the app root.
  const resolutionChainDirs = (targetRelative: string): string[] => {
    const segments = targetRelative.split('/');
    const dirs: string[] = [`${segments.join('/')}/node_modules`];
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (segments[index] === 'node_modules') {
        dirs.push(segments.slice(0, index + 1).join('/'));
      }
    }
    return dirs;
  };

  const targets = new Map<string, Set<string>>();
  const occupancy = new Map<string, string>();
  const placements = new Map<string, RuntimePlacement>();
  const unpackPaths = new Set<string>();
  let packagePlacementCount = 0;

  const addPlacement = (node: ClosureNode, targetRelative: string): boolean => {
    const nodeTargets = targets.get(node.key);
    if (nodeTargets?.has(targetRelative)) return false;

    const occupant = occupancy.get(targetRelative);
    if (occupant === node.key) {
      nodeTargets?.add(targetRelative);
      return false;
    }
    if (occupant !== undefined) {
      const conflictingNode = nodes.get(occupant);
      throw new Error(
        `Runtime dependency staging collision at "${targetRelative}": "${conflictingNode?.name ?? occupant}@${conflictingNode?.version ?? 'unknown'}" and "${node.name}@${node.version}" both claim it.`
      );
    }
    if (packagePlacementCount >= MAX_RUNTIME_PACKAGE_PLACEMENTS) {
      throw new Error(
        `Runtime dependency staging exceeded ${MAX_RUNTIME_PACKAGE_PLACEMENTS} package placements — the dependency graph is too nested to package safely.`
      );
    }

    packagePlacementCount += 1;
    occupancy.set(targetRelative, node.key);
    if (!nodeTargets) targets.set(node.key, new Set([targetRelative]));
    else nodeTargets.add(targetRelative);

    const rule = specialRules[node.name];
    const sources: RuntimePlacement[] = rule
      ? rule.include
          .map(relativeInclude => ({
            sourcePath: path.join(node.realpath, relativeInclude),
            targetRelative: `${targetRelative}/${relativeInclude}`,
          }))
          .filter(source => fs.existsSync(source.sourcePath))
      : [{ sourcePath: node.realpath, targetRelative }];
    for (const source of sources) {
      placements.set(source.targetRelative, source);
    }
    for (const unpackPath of rule?.unpack ?? []) {
      unpackPaths.add(`${targetRelative}/${unpackPath}`);
    }
    return true;
  };

  const getResolvedNodeKey = (consumerTarget: string, packageName: string): string | null => {
    for (const directory of resolutionChainDirs(consumerTarget)) {
      const nodeKey = occupancy.get(`${directory}/${packageName}`);
      if (nodeKey !== undefined) return nodeKey;
    }
    return null;
  };

  type PlacementCandidate = { directory: string; coverage: string[] };
  const findPlacementCandidate = (
    node: ClosureNode,
    consumerTargets: ReadonlySet<string>
  ): PlacementCandidate | null => {
    const chains = Array.from(consumerTargets, consumerTarget => ({
      consumerTarget,
      directories: resolutionChainDirs(consumerTarget),
    }));
    const candidateDirectories = new Set(chains.flatMap(({ directories }) => directories));
    const candidates: PlacementCandidate[] = [];

    for (const directory of candidateDirectories) {
      const packageTarget = `${directory}/${node.name}`;
      const occupant = occupancy.get(packageTarget);
      if (occupant !== undefined && occupant !== node.key) continue;

      const coverage = chains
        .filter(({ directories }) => {
          const candidateIndex = directories.indexOf(directory);
          if (candidateIndex === -1) return false;
          return directories.slice(0, candidateIndex).every(nearerDirectory => {
            const nearerOccupant = occupancy.get(`${nearerDirectory}/${node.name}`);
            return nearerOccupant === undefined || nearerOccupant === node.key;
          });
        })
        .map(({ consumerTarget }) => consumerTarget);

      if (coverage.length > 0) candidates.push({ directory, coverage });
    }

    candidates.sort(
      (left, right) =>
        left.directory.split('/').length - right.directory.split('/').length ||
        right.coverage.length - left.coverage.length ||
        left.directory.localeCompare(right.directory)
    );
    return candidates[0] ?? null;
  };

  for (const node of rootNodesByName.values()) {
    addPlacement(node, `node_modules/${node.name}`);
  }

  const collectDemands = (): Map<string, Set<string>> => {
    const demands = new Map<string, Set<string>>();
    for (const [consumerKey, childKeys] of edges) {
      for (const consumerTarget of targets.get(consumerKey) ?? []) {
        for (const childKey of childKeys) {
          const child = nodes.get(childKey);
          if (!child || getResolvedNodeKey(consumerTarget, child.name) === childKey) continue;
          const consumerTargets = demands.get(childKey) ?? new Set<string>();
          consumerTargets.add(consumerTarget);
          demands.set(childKey, consumerTargets);
        }
      }
    }
    return demands;
  };

  // Process graph edges from the root placements. A package can have several
  // staged copies, so every consumer destination must flow to its dependencies.
  // Shared installs go in a safe common directory. If a conflict shadows only
  // part of the consumer paths, the remaining scopes receive their own copy.
  let demands = collectDemands();
  while (demands.size > 0) {
    let madeProgress = false;
    for (const [childKey, consumerTargets] of demands) {
      const child = nodes.get(childKey);
      if (!child) continue;

      let pendingTargets = new Set(
        Array.from(consumerTargets).filter(
          consumerTarget => getResolvedNodeKey(consumerTarget, child.name) !== childKey
        )
      );
      while (pendingTargets.size > 0) {
        const candidate = findPlacementCandidate(child, pendingTargets);
        if (!candidate) {
          const consumerTarget = pendingTargets.values().next().value as string | undefined;
          throw new Error(
            `Cannot stage runtime dependency "${child.name}@${child.version}" for "${consumerTarget ?? 'unknown consumer'}": every Node resolution path is shadowed by another installed copy.`
          );
        }

        const added = addPlacement(child, `${candidate.directory}/${child.name}`);
        madeProgress ||= added;
        const nextPendingTargets = new Set(
          Array.from(pendingTargets).filter(
            consumerTarget => getResolvedNodeKey(consumerTarget, child.name) !== childKey
          )
        );
        if (!added && nextPendingTargets.size === pendingTargets.size) {
          throw new Error(
            `Runtime dependency staging made no progress for "${child.name}@${child.version}" at "${candidate.directory}".`
          );
        }
        pendingTargets = nextPendingTargets;
      }
    }

    if (!madeProgress) {
      throw new Error('Runtime dependency staging could not satisfy all package resolution edges.');
    }
    demands = collectDemands();
  }

  return {
    placements: Array.from(placements.values()).sort((left, right) =>
      left.targetRelative.localeCompare(right.targetRelative)
    ),
    unpackPaths: Array.from(unpackPaths).sort(),
  };
};

/** Copy the resolved runtime packages into the packager's staging dir (forge `afterCopy`). */
export const copyRuntimePackagesInto = (
  projectDir: string,
  buildPath: string,
  platform: NodeJS.Platform = process.platform
): void => {
  for (const { sourcePath, targetRelative } of resolveRuntimePackagingPlan(
    projectDir,
    platform
  ).placements) {
    const destination = path.join(buildPath, targetRelative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(sourcePath, destination, { recursive: true, dereference: true });
  }
};

/** forge `afterCopy` hook that stages the runtime packages into the app. */
export const createRuntimePackageCopier =
  (projectDir: string) =>
  (
    buildPath: string,
    _electronVersion: string,
    platform: NodeJS.Platform,
    _arch: string,
    callback: (error?: Error) => void
  ): void => {
    try {
      copyRuntimePackagesInto(projectDir, buildPath, platform);
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  };

export const createRuntimeAsarConfig = (
  projectDir: string,
  platform: NodeJS.Platform = process.platform
): true | { unpack?: string } => {
  const { unpackPaths } = resolveRuntimePackagingPlan(projectDir, platform);
  if (unpackPaths.length === 0) return true;
  return { unpack: `{${unpackPaths.join(',')}}` };
};

export const createVitePackagingIgnore = (projectDir: string): ((file: string) => boolean) => {
  void projectDir;
  // Everything the app needs either ships inside `.vite` (the bundles), is the
  // manifest itself, or is staged into `node_modules` by the afterCopy copier.
  return (file: string): boolean => {
    if (!file) return false;
    const candidatePath = normalizePath(file);
    if (candidatePath === '/package.json') return false;
    return candidatePath !== '/.vite' && !candidatePath.startsWith('/.vite/');
  };
};
