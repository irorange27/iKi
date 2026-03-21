import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createVitePackagingIgnore,
  resolveRuntimeDependencyPackagePaths,
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

describe('runtime_packaging', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (!tempDir) continue;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves external runtime dependency closures across hoisted and nested packages', () => {
    const projectDir = createTempProject();

    writeJson(path.join(projectDir, 'package-lock.json'), {
      name: 'fixture',
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/better-sqlite3': {
          dependencies: {
            bindings: '^1.5.0',
          },
        },
        'node_modules/bindings': {},
        'node_modules/whisper-node': {
          dependencies: {
            'node-addon-api': '^8.0.0',
          },
        },
        'node_modules/whisper-node/node_modules/node-addon-api': {},
      },
    });

    writeJson(path.join(projectDir, 'node_modules/better-sqlite3/package.json'), {
      name: 'better-sqlite3',
      version: '1.0.0',
    });
    writeJson(path.join(projectDir, 'node_modules/bindings/package.json'), {
      name: 'bindings',
      version: '1.0.0',
    });
    writeJson(path.join(projectDir, 'node_modules/whisper-node/package.json'), {
      name: 'whisper-node',
      version: '1.0.0',
    });
    writeJson(path.join(projectDir, 'node_modules/whisper-node/node_modules/node-addon-api/package.json'), {
      name: 'node-addon-api',
      version: '1.0.0',
    });

    expect(
      resolveRuntimeDependencyPackagePaths(projectDir, ['better-sqlite3', 'whisper-node'])
    ).toEqual([
      'node_modules/better-sqlite3',
      'node_modules/bindings',
      'node_modules/whisper-node',
      'node_modules/whisper-node/node_modules/node-addon-api',
    ]);
  });

  it('creates a Vite packaging ignore filter that keeps externals and their ancestor directories', () => {
    const projectDir = createTempProject();

    writeJson(path.join(projectDir, 'package-lock.json'), {
      name: 'fixture',
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/better-sqlite3': {},
      },
    });
    writeJson(path.join(projectDir, 'node_modules/better-sqlite3/package.json'), {
      name: 'better-sqlite3',
      version: '1.0.0',
    });

    const ignore = createVitePackagingIgnore(projectDir, ['better-sqlite3']);

    expect(ignore('/.vite/build/main.js')).toBe(false);
    expect(ignore('/node_modules')).toBe(false);
    expect(ignore('/node_modules/better-sqlite3')).toBe(false);
    expect(ignore('/node_modules/better-sqlite3/build/Release/better_sqlite3.node')).toBe(false);
    expect(ignore('/src/main.ts')).toBe(true);
    expect(ignore('/node_modules/left-pad/index.js')).toBe(true);
  });
});
