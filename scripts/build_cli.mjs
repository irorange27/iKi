#!/usr/bin/env node
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = path.join(repoRoot, 'packages/cli');
const outDir = path.join(cliRoot, 'dist');
const outFile = path.join(outDir, 'iki.mjs');
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const npmPackageName = process.env.IKI_NPM_PACKAGE_NAME || '@irorange27/iki';

const workspaceAlias = (pkgName, pkgDir) => ({
  find: new RegExp(`^@iki/${pkgName}(?:/(.*))?$`),
  replacement: path.join(repoRoot, `packages/${pkgDir}/src/$1`),
});

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
]);

await build({
  configFile: false,
  root: cliRoot,
  logLevel: 'warn',
  define: {
    __IKI_CLI_VERSION__: JSON.stringify(rootPkg.version),
    __IKI_NPM_PACKAGE__: JSON.stringify(npmPackageName),
  },
  resolve: {
    alias: [
      workspaceAlias('core', 'core'),
      workspaceAlias('theme', 'theme'),
      workspaceAlias('store', 'store'),
      workspaceAlias('session', 'session'),
      workspaceAlias('system-prompt', 'system-prompt'),
      workspaceAlias('llm', 'llm'),
      workspaceAlias('llm-pi-ai', 'llm-pi-ai'),
      workspaceAlias('agent', 'agent'),
      workspaceAlias('agent-loop', 'agent-loop'),
      workspaceAlias('tools', 'tools'),
      workspaceAlias('harness', 'harness'),
    ],
    conditions: ['node', 'import', 'module', 'default'],
  },
  ssr: {
    target: 'node',
    noExternal: true,
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'node24',
    minify: true,
    sourcemap: false,
    ssr: path.join(cliRoot, 'src/main.ts'),
    rollupOptions: {
      external: id => nodeBuiltins.has(id),
      output: {
        format: 'es',
        entryFileNames: 'iki.mjs',
        codeSplitting: false,
        banner: [
          '#!/usr/bin/env node',
          "import { createRequire as __ikiCreateRequire } from 'node:module';",
          'const require = __ikiCreateRequire(import.meta.url);',
        ].join('\n'),
      },
    },
  },
});

fs.chmodSync(outFile, 0o755);
const stat = fs.statSync(outFile);
console.log(`Built standalone CLI bundle: ${path.relative(repoRoot, outFile)} (${(stat.size / 1024).toFixed(1)} KB)`);
