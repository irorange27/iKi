import { describe, expect, it } from 'vitest';

import { isPathWithinRoot } from '@iki/backend/utils/path_boundary';

describe('path boundary utils', () => {
  it('accepts paths inside the root', () => {
    expect(isPathWithinRoot('/workspace', '/workspace/nested/file.txt')).toBe(true);
  });

  it('rejects paths outside the root', () => {
    expect(isPathWithinRoot('/workspace', '/other/file.txt')).toBe(false);
  });
});
