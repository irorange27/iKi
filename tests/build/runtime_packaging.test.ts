import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

    expect(
      fs.existsSync(path.join(buildPath, 'node_modules/branch-a/node_modules/ws/index.js'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(buildPath, 'node_modules/branch-b/node_modules/ws/index.js'))
    ).toBe(true);
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
