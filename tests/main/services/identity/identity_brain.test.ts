import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureIdentityBrainLayout,
  getIdentityBrainDocuments,
} from '../../../../src/main/services/identity/identity_brain';

const tempDirs: string[] = [];

const createTempUserDataPath = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-identity-brain-'));
  tempDirs.push(directory);
  process.env.IKI_USER_DATA_PATH = directory;
  return directory;
};

beforeEach(() => {
  delete process.env.IKI_USER_DATA_PATH;
});

describe('identity_brain', () => {
  it('creates the local brain markdown layout', () => {
    const userDataPath = createTempUserDataPath();

    const rootPath = ensureIdentityBrainLayout();

    expect(rootPath).toBe(path.join(userDataPath, 'brain'));
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'iki.md'))).toBe(true);
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'owner.md'))).toBe(true);
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'memory_inbox'))).toBe(true);
    expect(fs.existsSync(path.join(userDataPath, 'brain', 'reflections'))).toBe(true);
  });

  it('returns only meaningful local brain markdown content', () => {
    const userDataPath = createTempUserDataPath();
    const brainPath = path.join(userDataPath, 'brain');
    fs.mkdirSync(brainPath, { recursive: true });
    fs.writeFileSync(
      path.join(brainPath, 'owner.md'),
      '# Owner\n\n- Preferred name: Nina\n- Reply language: Simplified Chinese\n',
      'utf8'
    );

    const documents = getIdentityBrainDocuments();

    expect(documents.iki).toBe('');
    expect(documents.owner).toContain('Preferred name: Nina');
    expect(documents.owner).toContain('Reply language: Simplified Chinese');
  });
});

afterEach(() => {
  delete process.env.IKI_USER_DATA_PATH;
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (!directory) continue;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
