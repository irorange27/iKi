
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG = path.join(REPO_ROOT, '.dependency-cruiser.cjs');
const DEPCRUISE = path.join(REPO_ROOT, 'node_modules', '.bin', 'depcruise');

type Control = {
  
  rule: string;
  
  from: string;
  
  to: string;
  
  extra?: Record<string, string>;
};

const CONTROLS: Control[] = [
  {
    rule: 'backend-stays-pure',
    from: 'packages/backend/src/probe.ts',
    to: 'node_modules/vue/index.js',
  },
  {
    rule: 'no-reverse-dependency',
    from: 'packages/backend/src/probe.ts',
    to: 'packages/desktop/src/probe.ts',
  },
  {
    rule: 'provider-is-leaf',
    from: 'packages/backend/src/provider/probe.ts',
    to: 'packages/backend/src/tools/probe.ts',
  },
  {
    rule: 'tools-below-session',
    from: 'packages/backend/src/tools/probe.ts',
    to: 'packages/backend/src/thread_session/probe.ts',
  },
  {
    rule: 'agent-below-session-and-orchestration',
    from: 'packages/backend/src/agent/probe.ts',
    to: 'packages/backend/src/turn_prep/probe.ts',
  },
  {
    rule: 'turn-prep-below-session',
    from: 'packages/backend/src/turn_prep/probe.ts',
    to: 'packages/backend/src/thread_session/probe.ts',
  },
  {
    rule: 'db-migration-above-database',
    from: 'packages/backend/src/db/migration/probe.ts',
    to: 'packages/backend/src/db/database.ts',
  },
  {
    rule: 'session-reads-no-global-config',
    from: 'packages/backend/src/turn_prep/probe.ts',
    to: 'packages/backend/src/config.ts',
  },
  {
    rule: 'renderer-backend-whitelist',
    from: 'packages/desktop/src/renderer/probe.ts',
    to: 'packages/backend/src/tools/probe.ts',
  },
  {
    rule: 'renderer-no-schema-heavy-closure',
    from: 'packages/desktop/src/renderer/probe.ts',
    to: 'packages/backend/src/message/hop.ts',
    extra: {
      'packages/backend/src/message/hop.ts':
        "import { deep } from '@iki/backend/provider/deep';\nexport const hop = deep;\n",
      'packages/backend/src/provider/deep.ts': 'export const deep = 1;\n',
    },
  },
  {
    rule: 'shells-no-db-migrations',
    from: 'packages/daemon/src/probe.ts',
    to: 'packages/backend/src/db/migration/probe.ts',
  },
];

const writeFixture = async (root: string, control: Control): Promise<void> => {
  await fs.writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          noEmit: true,
          moduleResolution: 'bundler',
          paths: {
            '@iki/backend': ['./packages/backend/src/index.ts'],
            '@iki/backend/*': ['./packages/backend/src/*'],
            '@iki/desktop/*': ['./packages/desktop/src/*'],
            '@iki/daemon/*': ['./packages/daemon/src/*'],
          },
        },
        include: ['packages/**/*.ts'],
      },
      null,
      2
    ),
    'utf8'
  );
  const files = new Map<string, string>(Object.entries(control.extra ?? {}));
  if (!files.has(control.to)) files.set(control.to, 'export const value = 1;\n');

  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  const fromAbs = path.join(root, control.from);
  await fs.mkdir(path.dirname(fromAbs), { recursive: true });
  const iFrom = control.from.split('/');
  const iTo = control.to.split('/');
  const samePackage = iFrom[0] === iTo[0] && iFrom[1] === iTo[1] && !control.to.startsWith('node_modules/');
  let spec: string;
  if (samePackage) {
    spec = path.relative(path.dirname(fromAbs), path.join(root, control.to));
    spec = spec.replace(/\.ts$/, '').replace(/\.js$/, '');
    if (!spec.startsWith('.')) spec = `./${spec}`;
  } else {
    spec = `@iki/${iTo[1]}/${iTo.slice(3).join('/')}`.replace(/\.ts$/, '').replace(/\.js$/, '');
    if (control.to.startsWith('node_modules/')) {
      spec = control.to.replace(/^node_modules\//, '').replace(/\/index\.js$/, '');
    }
    const aliasPkg = iTo[1];
    const linkDir = path.join(root, 'node_modules', '@iki');
    await fs.mkdir(linkDir, { recursive: true });
    const linkPath = path.join(linkDir, aliasPkg);
    try {
      await fs.symlink(path.join(root, 'packages', aliasPkg), linkPath, 'dir');
    } catch {
      /* empty: error is not actionable here */
    }
  }
  await fs.writeFile(
    fromAbs,
    `import { value } from '${spec}';\nexport const probe = value;\n`,
    'utf8'
  );
};

describe('package-boundary rules have negative controls', () => {
  it.each(CONTROLS.map(control => [control.rule, control] as const))(
    '%s fires on a violating import',
    async (_name, control) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-archctl-'));
      try {
        await writeFixture(root, control);

        let violated: string[] = [];
        try {
          const { stdout } = await exec(
            DEPCRUISE,
            ['packages', '--config', CONFIG, '--output-type', 'json'],
            { cwd: root, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }
          );
          violated = extractRuleNames(stdout);
        } catch (error) {
          const failed = error as { stdout?: string; stderr?: string };
          const raw = failed.stdout ?? '';
          violated = extractRuleNames(raw);
          if (violated.length === 0) {
            throw new Error(
              `depcruise failed without reporting a rule violation for ${control.rule}: ${
                failed.stderr ?? raw
              }`
            );
          }
        }

        expect(
          violated,
          `rule ${control.rule} did not fire on ${control.from} -> ${control.to}; ` +
            'either the rule was weakened or its path anchors moved'
        ).toContain(control.rule);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  );
});

const extractRuleNames = (stdout: string): string[] => {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(trimmed) as { summary?: { violations?: Array<{ rule?: { name?: string } }> } };
    const violations = parsed.summary?.violations ?? [];
    return violations.map(v => v.rule?.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
};
