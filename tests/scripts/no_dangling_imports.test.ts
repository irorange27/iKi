import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('type gate coverage', () => {
  it('type-checks every backend source file, not only what the shells import', () => {
    const tsconfig = JSON.parse(
      execFileSync('node', ['-e', 'process.stdout.write(require("fs").readFileSync("tsconfig.json","utf8"))'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
    ) as { include?: string[] };

    const include = tsconfig.include ?? [];
    const coversBackend = include.some(
      pattern => pattern.startsWith('packages/backend/src/') && pattern.endsWith('/**/*')
    );
    expect(coversBackend).toBe(true);
  });
});
