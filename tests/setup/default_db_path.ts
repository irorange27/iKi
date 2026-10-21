
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach } from 'vitest';

const scratchUserDataPath = mkdtempSync(join(tmpdir(), 'iki-test-user-data-'));

beforeEach(() => {
  process.env.IKI_USER_DATA_PATH ??= scratchUserDataPath;
});
