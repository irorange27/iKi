import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  generateBootstrapToken,
  readOrCreateBootstrapToken,
  rotateBootstrapToken,
} from '../../src/daemon/bootstrap_token';

describe('daemon bootstrap tokens', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates high-entropy bootstrap tokens', () => {
    const first = generateBootstrapToken();
    const second = generateBootstrapToken();

    expect(first).toMatch(/^iki_bootstrap_[a-f0-9]{64}$/);
    expect(second).toMatch(/^iki_bootstrap_[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  it('persists and reuses the bootstrap token until rotated', () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-daemon-token-'));
    tempDirs.push(userDataPath);

    const first = readOrCreateBootstrapToken(userDataPath);
    const second = readOrCreateBootstrapToken(userDataPath);

    expect(second).toBe(first);
    expect(fs.readFileSync(path.join(userDataPath, 'daemon.token'), 'utf8')).toBe(first);
  });

  it('rotates the bootstrap token after use', () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-daemon-token-'));
    tempDirs.push(userDataPath);

    const first = readOrCreateBootstrapToken(userDataPath);
    const rotated = rotateBootstrapToken(userDataPath);

    expect(rotated).not.toBe(first);
    expect(fs.readFileSync(path.join(userDataPath, 'daemon.token'), 'utf8')).toBe(rotated);
  });
});
