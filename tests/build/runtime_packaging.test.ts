import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import {
  copyRuntimePackagesInto,
  createRuntimeAsarConfig,
  createRuntimePackageCopier,
  createVitePackagingIgnore,
  resolveRuntimePackagingPlan,
} from '../../packages/desktop/src/build/runtime_packaging';

const tempDirs: string[] = [];

/**
 * Monorepo-style fixture: the packaging project dir is a workspace package,
 * while the installed packages live in the repo-root node_modules (pnpm store
 * layout) — outside the project dir, reachable only by node's upward walk.
 */
const createFixture = (): { rootDir: string; projectDir: string } => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-runtime-packaging-'));
  tempDirs.push(rootDir);
  const projectDir = path.join(rootDir, 'packages/desktop');
  fs.mkdirSync(projectDir, { recursive: true });
  return { rootDir, projectDir };
};

const writeJson = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const writeText = (filePath: string, value = '') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
};

const symlinkDirectory = (targetPath: string, linkPath: string) => {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
};

const seedRootPackages = (rootDir: string) => {
  writeJson(path.join(rootDir, 'node_modules/ffmpeg-static/package.json'), {
    name: 'ffmpeg-static',
    version: '1.0.0',
  });
  writeText(path.join(rootDir, 'node_modules/ffmpeg-static/index.js'), 'module.exports = "ffmpeg";');
  writeText(path.join(rootDir, 'node_modules/ffmpeg-static/ffmpeg'), 'binary');

  writeJson(path.join(rootDir, 'node_modules/whisper-node/package.json'), {
    name: 'whisper-node',
    version: '1.0.0',
  });
  writeText(path.join(rootDir, 'node_modules/whisper-node/lib/whisper.cpp/main'), 'binary');
  writeText(
    path.join(rootDir, 'node_modules/whisper-node/lib/whisper.cpp/models/ggml-large-v3-turbo.bin'),
    'oversized-model'
  );

  writeJson(path.join(rootDir, 'node_modules/ws/package.json'), {
    name: 'ws',
    version: '1.0.0',
  });
  writeText(path.join(rootDir, 'node_modules/ws/index.js'), 'module.exports = {};');

  writeJson(path.join(rootDir, 'node_modules/ajv/package.json'), {
    name: 'ajv',
    version: '1.0.0',
  });
  writeText(path.join(rootDir, 'node_modules/ajv/dist/runtime/equal.js'), 'module.exports = {};');

  writeJson(path.join(rootDir, 'node_modules/ajv-formats/package.json'), {
    name: 'ajv-formats',
    version: '1.0.0',
    peerDependencies: {
      ajv: '^8.0.0',
    },
  });
  writeText(path.join(rootDir, 'node_modules/ajv-formats/dist/formats.js'), 'module.exports = {};');
};

const writeBuildFixture = (projectDir: string, fileName: string, sourceLines: string[]) => {
  writeText(path.join(projectDir, `.vite/build/${fileName}`), sourceLines.join('\n'));
};

const DEFAULT_BUILD_FIXTURE: string[] = [
  'require("ws");',
  'require("ajv/dist/runtime/equal");',
  'require("ajv-formats/dist/formats");',
  'require("whisper-node");',
  'require("node:fs");',
];

const targetRelativePaths = (projectDir: string, platform: NodeJS.Platform = 'darwin'): string[] =>
  resolveRuntimePackagingPlan(projectDir, platform).placements.map(
    placement => placement.targetRelative
  );

describe('runtime_packaging', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (!tempDir) continue;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves installed packages that live outside the project dir into app targets', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    writeBuildFixture(projectDir, 'main-test.js', DEFAULT_BUILD_FIXTURE);

    expect(targetRelativePaths(projectDir)).toEqual([
      'node_modules/ajv',
      'node_modules/ajv-formats',
      'node_modules/ffmpeg-static/ffmpeg',
      'node_modules/ffmpeg-static/index.js',
      'node_modules/ffmpeg-static/package.json',
      'node_modules/whisper-node/lib/whisper.cpp/main',
      'node_modules/whisper-node/package.json',
      'node_modules/ws',
    ]);

    const { placements } = resolveRuntimePackagingPlan(projectDir, 'darwin');
    const wsSource = placements.find(
      placement => placement.targetRelative === 'node_modules/ws'
    );
    expect(wsSource?.sourcePath).toBe(fs.realpathSync(path.join(rootDir, 'node_modules/ws')));
  });

  it('detects runtime packages loaded through createRequire aliases', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    writeBuildFixture(projectDir, 'main-create-require.js', [
      'const { createRequire } = require("node:module");',
      'const nodeRequire = createRequire(__filename);',
      'nodeRequire("ws");',
      'nodeRequire.resolve("ajv-formats/package.json");',
      'nodeRequire.resolve("node:fs");',
    ]);

    expect(targetRelativePaths(projectDir)).toEqual([
      'node_modules/ajv',
      'node_modules/ajv-formats',
      'node_modules/ffmpeg-static/ffmpeg',
      'node_modules/ffmpeg-static/index.js',
      'node_modules/ffmpeg-static/package.json',
      'node_modules/whisper-node/lib/whisper.cpp/main',
      'node_modules/whisper-node/package.json',
      'node_modules/ws',
    ]);
  });

  it('copies the staged packages into the build path, filtering whisper model payloads', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    writeBuildFixture(projectDir, 'main-test.js', DEFAULT_BUILD_FIXTURE);
    const buildPath = path.join(rootDir, 'build-staging');

    copyRuntimePackagesInto(projectDir, buildPath, 'darwin');

    expect(fs.existsSync(path.join(buildPath, 'node_modules/ws/index.js'))).toBe(true);
    expect(fs.existsSync(path.join(buildPath, 'node_modules/ajv/dist/runtime/equal.js'))).toBe(true);
    expect(fs.existsSync(path.join(buildPath, 'node_modules/ffmpeg-static/ffmpeg'))).toBe(true);
    expect(
      fs.existsSync(path.join(buildPath, 'node_modules/whisper-node/lib/whisper.cpp/main'))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(buildPath, 'node_modules/whisper-node/lib/whisper.cpp/models/ggml-large-v3-turbo.bin')
      )
    ).toBe(false);
  });

  it('exposes an afterCopy hook that stages into the packager build path', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    writeBuildFixture(projectDir, 'main-test.js', DEFAULT_BUILD_FIXTURE);
    const buildPath = path.join(rootDir, 'build-staging');

    const hook = createRuntimePackageCopier(projectDir);
    hook(buildPath, '37.0.0', 'darwin', 'arm64', error => {
      expect(error).toBeUndefined();
    });

    expect(fs.existsSync(path.join(buildPath, 'node_modules/ws/index.js'))).toBe(true);
  });

  it('nests a consumer-specific dependency version instead of failing the build', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    writeBuildFixture(projectDir, 'main-test.js', DEFAULT_BUILD_FIXTURE);
    // ajv-formats gets its own ws copy with a different major (pnpm layout).
    writeJson(path.join(rootDir, 'node_modules/ajv-formats/package.json'), {
      name: 'ajv-formats',
      version: '1.0.0',
      dependencies: {
        ws: '^2.0.0',
      },
      peerDependencies: {
        ajv: '^8.0.0',
      },
    });
    writeJson(path.join(rootDir, 'node_modules/ajv-formats/node_modules/ws/package.json'), {
      name: 'ws',
      version: '2.0.0',
    });
    writeText(path.join(rootDir, 'node_modules/ajv-formats/node_modules/ws/index.js'), 'nested');

    const { placements } = resolveRuntimePackagingPlan(projectDir, 'darwin');
    const targets = placements.map(placement => placement.targetRelative);
    expect(targets).toContain('node_modules/ws');
    expect(targets).toContain('node_modules/ajv-formats/node_modules/ws');

    const nested = placements.find(
      placement => placement.targetRelative === 'node_modules/ajv-formats/node_modules/ws'
    );
    expect(nested?.sourcePath).toBe(
      fs.realpathSync(path.join(rootDir, 'node_modules/ajv-formats/node_modules/ws'))
    );
  });

  it('stages a non-hoisted version under every consumer, not just the first branch', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    writeBuildFixture(projectDir, 'main-test.js', [
      'require("ws");',
      'require("branch-a");',
      'require("branch-b");',
    ]);
    // Two independent consumers on different branches share ws@2 while ws@1
    // owns the root slot — each branch needs its own resolvable copy.
    for (const branch of ['branch-a', 'branch-b']) {
      writeJson(path.join(rootDir, `node_modules/${branch}/package.json`), {
        name: branch,
        version: '1.0.0',
        dependencies: {
          ws: '^2.0.0',
        },
      });
      writeText(path.join(rootDir, `node_modules/${branch}/index.js`), 'module.exports = {};');
      writeJson(path.join(rootDir, `node_modules/${branch}/node_modules/ws/package.json`), {
        name: 'ws',
        version: '2.0.0',
      });
      writeText(path.join(rootDir, `node_modules/${branch}/node_modules/ws/index.js`), 'nested');
    }
    const buildPath = path.join(rootDir, 'build-staging');

    copyRuntimePackagesInto(projectDir, buildPath, 'darwin');

    // Each branch must resolve its own physical ws@2 copy — existence alone
    // would not catch a shared-wrong-source or root-version regression.
    for (const branch of ['branch-a', 'branch-b']) {
      const branchDir = path.join(buildPath, 'node_modules', branch);
      const stagedManifest = JSON.parse(
        fs.readFileSync(path.join(branchDir, 'node_modules/ws/package.json'), 'utf8')
      );
      expect(stagedManifest.version).toBe('2.0.0');

      const branchRequire = createRequire(path.join(branchDir, 'index.js'));
      const resolvedRealPath = fs.realpathSync(branchRequire.resolve('ws'));
      expect(resolvedRealPath).toBe(
        path.join(fs.realpathSync(branchDir), 'node_modules/ws/index.js')
      );
    }
  });

  it('keeps same-version physical installs and their peer contexts isolated', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    writeJson(path.join(rootDir, 'node_modules/peer-context/package.json'), {
      name: 'peer-context',
      version: '1.0.0',
    });
    writeText(path.join(rootDir, 'node_modules/peer-context/index.js'), 'module.exports = "root";');
    writeBuildFixture(projectDir, 'main-test.js', [
      'require("ws");',
      'require("branch-a");',
      'require("branch-b");',
      'require("peer-context");',
    ]);

    for (const [branch, peerValue] of [
      ['branch-a', 'peer-a'],
      ['branch-b', 'peer-b'],
    ]) {
      const branchStore = path.join(rootDir, `node_modules/.pnpm/${branch}/node_modules`);
      const wsStore = path.join(rootDir, `node_modules/.pnpm/${branch}-ws/node_modules`);
      const branchPackage = path.join(branchStore, branch);
      const wsPackage = path.join(wsStore, 'ws');
      const peerPackage = path.join(wsStore, 'peer-context');

      writeJson(path.join(branchPackage, 'package.json'), {
        name: branch,
        version: '1.0.0',
        dependencies: { ws: '^2.0.0' },
      });
      writeText(path.join(branchPackage, 'index.js'), 'module.exports = require("ws");');
      writeJson(path.join(wsPackage, 'package.json'), {
        name: 'ws',
        version: '2.0.0',
        peerDependencies: { 'peer-context': '^2.0.0' },
      });
      writeText(path.join(wsPackage, 'index.js'), 'module.exports = require("peer-context");');
      writeJson(path.join(peerPackage, 'package.json'), {
        name: 'peer-context',
        version: '2.0.0',
      });
      writeText(path.join(peerPackage, 'index.js'), `module.exports = "${peerValue}";`);

      symlinkDirectory(branchPackage, path.join(rootDir, `node_modules/${branch}`));
      symlinkDirectory(wsPackage, path.join(branchStore, 'ws'));
    }

    const buildPath = path.join(rootDir, 'build-staging');
    copyRuntimePackagesInto(projectDir, buildPath, 'darwin');

    for (const [branch, expectedPeerValue] of [
      ['branch-a', 'peer-a'],
      ['branch-b', 'peer-b'],
    ]) {
      const branchDir = path.join(buildPath, 'node_modules', branch);
      const branchRequire = createRequire(path.join(branchDir, 'index.js'));
      const resolvedWs = branchRequire.resolve('ws');
      const stagedManifest = JSON.parse(
        fs.readFileSync(path.join(path.dirname(resolvedWs), 'package.json'), 'utf8')
      );

      expect(stagedManifest.version).toBe('2.0.0');
      expect(branchRequire('ws')).toBe(expectedPeerValue);
    }
  });

  it('shares deep diamond dependencies at their common safe ancestor', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);
    const rootPackages = ['shared', 'left', 'right', 'leaf'];
    for (const name of rootPackages) {
      writeJson(path.join(rootDir, `node_modules/${name}/package.json`), {
        name,
        version: '1.0.0',
      });
      writeText(path.join(rootDir, `node_modules/${name}/index.js`), `module.exports = "${name}-v1";`);
    }
    writeBuildFixture(projectDir, 'main-test.js', [
      'require("branch-a");',
      'require("branch-b");',
      ...rootPackages.map(name => `require("${name}");`),
    ]);

    const branchStoreRoot = path.join(rootDir, 'node_modules/.pnpm/branches/node_modules');
    const sharedStoreRoot = path.join(rootDir, 'node_modules/.pnpm/runtime-v2/node_modules');
    const sharedPackage = path.join(sharedStoreRoot, 'shared');
    for (const branch of ['branch-a', 'branch-b']) {
      const branchPackage = path.join(branchStoreRoot, branch);
      writeJson(path.join(branchPackage, 'package.json'), {
        name: branch,
        version: '1.0.0',
        dependencies: { shared: '^2.0.0' },
      });
      writeText(path.join(branchPackage, 'index.js'), 'module.exports = require("shared");');
      symlinkDirectory(branchPackage, path.join(rootDir, `node_modules/${branch}`));
    }

    for (const [name, dependencies, source] of [
      ['shared', { left: '^2.0.0', right: '^2.0.0' }, 'module.exports = [require("left"), require("right")];'],
      ['left', { leaf: '^2.0.0' }, 'module.exports = require("leaf");'],
      ['right', { leaf: '^2.0.0' }, 'module.exports = require("leaf");'],
      ['leaf', {}, 'module.exports = "leaf-v2";'],
    ] as const) {
      const packageDir = path.join(sharedStoreRoot, name);
      writeJson(path.join(packageDir, 'package.json'), { name, version: '2.0.0', dependencies });
      writeText(path.join(packageDir, 'index.js'), source);
    }
    symlinkDirectory(sharedPackage, path.join(branchStoreRoot, 'shared'));

    const buildPath = path.join(rootDir, 'build-staging');
    const { placements } = resolveRuntimePackagingPlan(projectDir, 'darwin');
    const leafV2Targets = placements
      .filter(
        placement =>
          placement.targetRelative !== 'node_modules/leaf' &&
          placement.targetRelative.endsWith('/node_modules/leaf')
      )
      .map(placement => placement.targetRelative)
      .sort();

    expect(leafV2Targets).toEqual([
      'node_modules/branch-a/node_modules/leaf',
      'node_modules/branch-b/node_modules/leaf',
    ]);

    copyRuntimePackagesInto(projectDir, buildPath, 'darwin');
    for (const branch of ['branch-a', 'branch-b']) {
      const branchRequire = createRequire(
        path.join(buildPath, 'node_modules', branch, 'index.js')
      );
      expect(branchRequire('shared')).toEqual(['leaf-v2', 'leaf-v2']);
    }
  });

  it('keeps only the vite bundles and the manifest in the project walk', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);

    const ignore = createVitePackagingIgnore(projectDir);

    expect(ignore('/package.json')).toBe(false);
    expect(ignore('/.vite/build/main.js')).toBe(false);
    expect(ignore('/src/main.ts')).toBe(true);
    expect(ignore('/node_modules/ws/index.js')).toBe(true);
    expect(ignore('')).toBe(false);
  });

  it('keeps the native executables unpacked from the asar', () => {
    const { rootDir, projectDir } = createFixture();
    seedRootPackages(rootDir);

    expect(createRuntimeAsarConfig(projectDir, 'darwin')).toEqual({
      unpack:
        '{node_modules/ffmpeg-static/ffmpeg,node_modules/whisper-node/lib/whisper.cpp/main}',
    });
  });
});
