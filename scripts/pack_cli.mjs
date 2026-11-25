#!/usr/bin/env node
/**
 * Stages a zero-dependency, publish-ready npm package for the standalone iKi CLI
 * under `packages/cli/dist/npm/` and runs `npm pack` into `packages/cli/dist/`.
 *
 * Usage:
 *   node scripts/pack_cli.mjs [--name <npm-package-name>] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliDistDir = path.join(repoRoot, 'packages/cli/dist');
const stageDir = path.join(cliDistDir, 'npm');
const bundlePath = path.join(cliDistDir, 'iki.mjs');

const parseCliArgs = argv => {
  let pkgName = process.env.IKI_NPM_PACKAGE_NAME || '@irorange27/iki';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) pkgName = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
  }
  return { pkgName, dryRun };
};

const { pkgName, dryRun } = parseCliArgs(process.argv.slice(2));

// 1. Build the standalone single-file Node 24 CLI bundle with matching npm package name
execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build_cli.mjs')], {
  cwd: repoRoot,
  env: { ...process.env, IKI_NPM_PACKAGE_NAME: pkgName },
  stdio: 'inherit',
});

const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

// 2. Stage clean publish directory with ZERO runtime dependencies
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(path.join(stageDir, 'bin'), { recursive: true });

const binOut = path.join(stageDir, 'bin/iki.mjs');
fs.copyFileSync(bundlePath, binOut);
fs.chmodSync(binOut, 0o755);

const licenseSrc = path.join(repoRoot, 'LICENSE');
if (fs.existsSync(licenseSrc)) {
  fs.copyFileSync(licenseSrc, path.join(stageDir, 'LICENSE'));
}

// Rewrite relative repo links in README so images & links render properly on npmjs.com
const repoBlobBase = 'https://github.com/irorange27/iKi/blob/main';
const repoRawBase = 'https://raw.githubusercontent.com/irorange27/iKi/main';
const rawReadme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const npmReadme = rawReadme
  .replace(/src="\.\/assets\//g, `src="${repoRawBase}/assets/`)
  .replace(/\]\(\.\/(README\.zh-CN\.md|LICENSE|\.dependency-cruiser\.cjs)\)/g, `](${repoBlobBase}/$1)`);
fs.writeFileSync(path.join(stageDir, 'README.md'), npmReadme, 'utf8');

const publishManifest = {
  name: pkgName,
  version: rootPkg.version,
  description: rootPkg.description,
  type: 'module',
  license: rootPkg.license,
  author: rootPkg.author,
  repository: rootPkg.repository,
  homepage: 'https://irorange27.github.io/iKi/',
  bugs: { url: 'https://github.com/irorange27/iKi/issues' },
  keywords: rootPkg.keywords,
  engines: { node: '>=24.0.0' },
  bin: { iki: 'bin/iki.mjs' },
  files: ['bin/iki.mjs', 'README.md', 'LICENSE'],
  dependencies: {},
};
fs.writeFileSync(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(publishManifest, null, 2)}\n`,
  'utf8'
);

// Remove stale tarballs in packages/cli/dist before packing
for (const entry of fs.readdirSync(cliDistDir)) {
  if (entry.endsWith('.tgz')) fs.rmSync(path.join(cliDistDir, entry), { force: true });
}

// 3. Run npm pack to verify the exact artifact npm will publish
const packArgs = ['pack', ...(dryRun ? ['--dry-run'] : ['--pack-destination', cliDistDir])];
const packOut = execFileSync('npm', packArgs, { cwd: stageDir, encoding: 'utf8' }).trim();
const tarballName = packOut.split('\n').pop()?.trim() || '';

console.log('');
console.log(`Staged npm package: ${pkgName}@${rootPkg.version} -> ${path.relative(repoRoot, stageDir)}`);
if (!dryRun && tarballName) {
  const tgzRel = path.relative(repoRoot, path.join(cliDistDir, tarballName));
  console.log(`Packed tarball:     ${tgzRel}`);
  console.log('');
  console.log('Test install locally:');
  console.log(`  npm install -g ./${tgzRel}`);
  console.log('Publish to npm (after `npm login`):');
  console.log(`  cd ${path.relative(repoRoot, stageDir)} && npm publish --access public`);
}
