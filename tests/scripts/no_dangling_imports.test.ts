import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Guards the hole that let `evals/` rot: the root tsconfig only includes the
 * two shells plus backend files they happen to import, so a backend module
 * nothing imports is never type-checked and a dangling import inside it stays
 * invisible. Reachability protects used code; nothing protected orphans.
 *
 * `tsconfig.json` now includes `packages/backend/src/**`, so `pnpm run ts`
 * catches these. This test states the invariant so a future narrowing of
 * `include` fails loudly instead of silently re-opening the hole.
 */
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
