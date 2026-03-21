import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

const createTempOutDir = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-preview-'));
  tempDirs.push(tempDir);
  return tempDir;
};

describe('run-packaged-preview', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (!tempDir) continue;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('normalizes product and package names without duplicates', async () => {
    const script = await import('../../scripts/run-packaged-preview.cjs');

    expect(
      script.normalizeAppNames({
        productName: 'iKi',
        packageName: 'iki',
      })
    ).toEqual(['iki']);
  });

  it('selects the packaged macOS app executable that matches the app name', async () => {
    const script = await import('../../scripts/run-packaged-preview.cjs');
    const outDir = createTempOutDir();
    const appExecutable = path.join(
      outDir,
      'iki-darwin-arm64',
      'iki.app',
      'Contents',
      'MacOS',
      'iki'
    );
    const helperExecutable = path.join(
      outDir,
      'iki-darwin-arm64',
      'iki.app',
      'Contents',
      'MacOS',
      'chrome-sandbox'
    );

    fs.mkdirSync(path.dirname(appExecutable), { recursive: true });
    fs.writeFileSync(appExecutable, '');
    fs.writeFileSync(helperExecutable, '');

    expect(
      script.resolvePackagedExecutable({
        outDir,
        productName: 'iKi',
        packageName: 'iki',
        platform: 'darwin',
      })
    ).toBe(appExecutable);
  });
});
