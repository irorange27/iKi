import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createRuntimeAsarConfig,
  createVitePackagingIgnore,
  resolveRuntimePackagingPaths,
  resolveRuntimeUnpackPaths,
} from '../../src/build/runtime_packaging';

const tempDirs: string[] = [];

const createTempProject = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-runtime-packaging-'));
  tempDirs.push(tempDir);
  return tempDir;
};

const writeJson = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const writeText = (filePath: string, value = '') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
};

const seedRuntimePackages = (projectDir: string) => {
  writeJson(path.join(projectDir, 'package-lock.json'), {
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/ajv': {},
      'node_modules/ajv-formats': {
        dependencies: {
          ajv: '^8.0.0',
        },
      },
      'node_modules/better-sqlite3': {
        dependencies: {
          bindings: '^1.5.0',
        },
      },
      'node_modules/bindings': {
        dependencies: {
          'file-uri-to-path': '^1.0.0',
        },
      },
      'node_modules/ffmpeg-static': {},
      'node_modules/file-uri-to-path': {},
      'node_modules/ws': {},
      'node_modules/whisper-node': {},
    },
  });

  writeJson(path.join(projectDir, 'node_modules/better-sqlite3/package.json'), {
    name: 'better-sqlite3',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/better-sqlite3/lib/index.js'), 'module.exports = {};');
  writeText(
    path.join(projectDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    'native'
  );

  writeJson(path.join(projectDir, 'node_modules/bindings/package.json'), {
    name: 'bindings',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/bindings/index.js'), 'module.exports = {};');

  writeJson(path.join(projectDir, 'node_modules/file-uri-to-path/package.json'), {
    name: 'file-uri-to-path',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/file-uri-to-path/index.js'), 'module.exports = {};');

  writeJson(path.join(projectDir, 'node_modules/ffmpeg-static/package.json'), {
    name: 'ffmpeg-static',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/ffmpeg-static/index.js'), 'module.exports = "ffmpeg";');
  writeText(path.join(projectDir, 'node_modules/ffmpeg-static/ffmpeg'), 'binary');

  writeJson(path.join(projectDir, 'node_modules/whisper-node/package.json'), {
    name: 'whisper-node',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/whisper-node/lib/whisper.cpp/main'), 'binary');
  writeText(
    path.join(projectDir, 'node_modules/whisper-node/lib/whisper.cpp/models/ggml-large-v3-turbo.bin'),
    'oversized-model'
  );

  writeJson(path.join(projectDir, 'node_modules/ws/package.json'), {
    name: 'ws',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/ws/index.js'), 'module.exports = {};');

  writeJson(path.join(projectDir, 'node_modules/ajv/package.json'), {
    name: 'ajv',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/ajv/dist/runtime/equal.js'), 'module.exports = {};');

  writeJson(path.join(projectDir, 'node_modules/ajv-formats/package.json'), {
    name: 'ajv-formats',
    version: '1.0.0',
  });
  writeText(path.join(projectDir, 'node_modules/ajv-formats/dist/formats.js'), 'module.exports = {};');

  writeText(
    path.join(projectDir, '.vite/build/main-test.js'),
    [
      'require("ws");',
      'require("ajv/dist/runtime/equal");',
      'require("ajv-formats/dist/formats");',
      'require("better-sqlite3");',
      'require("node:fs");',
    ].join('\n')
  );
};

describe('runtime_packaging', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (!tempDir) continue;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves only the runtime files that packaged apps need', () => {
    const projectDir = createTempProject();
    seedRuntimePackages(projectDir);

    expect(resolveRuntimePackagingPaths(projectDir, 'darwin')).toEqual([
      'node_modules/ajv',
      'node_modules/ajv-formats',
      'node_modules/better-sqlite3/build/Release',
      'node_modules/better-sqlite3/lib',
      'node_modules/better-sqlite3/package.json',
      'node_modules/bindings',
      'node_modules/ffmpeg-static/ffmpeg',
      'node_modules/ffmpeg-static/index.js',
      'node_modules/ffmpeg-static/package.json',
      'node_modules/file-uri-to-path',
      'node_modules/whisper-node/lib/whisper.cpp/main',
      'node_modules/whisper-node/package.json',
      'node_modules/ws',
    ]);
  });

  it('resolves the native and executable files that must stay unpacked', () => {
    const projectDir = createTempProject();
    seedRuntimePackages(projectDir);

    expect(resolveRuntimeUnpackPaths(projectDir, 'darwin')).toEqual([
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'node_modules/ffmpeg-static/ffmpeg',
      'node_modules/whisper-node/lib/whisper.cpp/main',
    ]);
    expect(createRuntimeAsarConfig(projectDir, 'darwin')).toEqual({
      unpack:
        '{**/node_modules/better-sqlite3/build/Release/better_sqlite3.node,**/node_modules/ffmpeg-static/ffmpeg,**/node_modules/whisper-node/lib/whisper.cpp/main}',
    });
  });

  it('keeps whitelisted runtime files while excluding whisper model payloads', () => {
    const projectDir = createTempProject();
    seedRuntimePackages(projectDir);

    const ignore = createVitePackagingIgnore(projectDir, 'darwin');

    expect(ignore('/package.json')).toBe(false);
    expect(ignore('/.vite/build/main.js')).toBe(false);
    expect(ignore('/node_modules')).toBe(false);
    expect(ignore('/node_modules/whisper-node/lib/whisper.cpp')).toBe(false);
    expect(ignore('/node_modules/whisper-node/lib/whisper.cpp/main')).toBe(false);
    expect(ignore('/node_modules/ffmpeg-static/ffmpeg')).toBe(false);
    expect(ignore('/node_modules/ws/index.js')).toBe(false);
    expect(ignore('/node_modules/ajv-formats/dist/formats.js')).toBe(false);
    expect(ignore('/node_modules/whisper-node/lib/whisper.cpp/models/ggml-large-v3-turbo.bin')).toBe(
      true
    );
    expect(ignore('/node_modules/left-pad/index.js')).toBe(true);
    expect(ignore('/src/main.ts')).toBe(true);
  });
});
