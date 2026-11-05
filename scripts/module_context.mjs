#!/usr/bin/env node
/**
 * Generate per-module bounded context for AI navigation (adapted from ZCode's
 * `architecture:context`, computed instead of declared):
 *
 *   node scripts/module_context.mjs [module-id]   # one module, or all
 *
 * Output: docs/generated/module-context/<id>.md (docs/ is untracked by design;
 * regenerate any time). The interesting number is the contract surface: which
 * files of a module are imported from OUTSIDE it — those files are the module's
 * de-facto public API, and the drift between that surface and the ownership map
 * is what this report exists to expose.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'scripts/module_registry.json'), 'utf8'));

const SOURCE_GLOBS = [
  'packages/backend/src',
  'packages/core/src',
  'packages/store/src',
  'packages/theme/src',
  'packages/desktop/src',
];
const EXTS = ['.ts', '.vue'];

const listFiles = (dir, out = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (EXTS.some(ext => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
};

const sources = SOURCE_GLOBS.flatMap(dir => listFiles(join(ROOT, dir)));
const repoRelative = file => relative(ROOT, file).replaceAll('\\', '/');

// --- module ownership --------------------------------------------------------

const modules = registry.modules
  .map(m => ({ ...m, roots: m.roots.map(r => repoRelative(join(ROOT, r))) }))
  // longest-prefix ownership: 'backend/standalone' (roots = all of backend/src)
  // must not swallow files owned by named modules
  .sort((a, b) => Math.max(...b.roots.map(r => r.length)) - Math.max(...a.roots.map(r => r.length)));

const ownerOf = file => {
  const rel = repoRelative(file);
  return modules.find(m => m.roots.some(root => rel.startsWith(root)));
};

// --- import graph ------------------------------------------------------------

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

const resolveSpecifier = (specifier, importer) => {
  let base = null;
  if (specifier.startsWith('@iki/backend/')) base = join(ROOT, 'packages/backend/src', specifier.slice('@iki/backend/'.length));
  else if (specifier.startsWith('@iki/theme/')) base = join(ROOT, 'packages/theme/src', specifier.slice('@iki/theme/'.length));
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier);
  else return null; // npm package
  const candidates = [base, ...EXTS.map(ext => base + ext), ...EXTS.map(ext => join(base, `index${ext}`))];
  return candidates.find(candidate => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
};

const importsOf = new Map(); // file -> resolved files
for (const file of sources) {
  const found = new Set();
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(IMPORT_RE)) {
    const resolved = resolveSpecifier(match[1], file);
    if (resolved && resolved !== file) found.add(resolved);
  }
  importsOf.set(file, [...found]);
}

// --- per-module metrics ------------------------------------------------------

const moduleOfImporters = new Map(); // module id -> Set of outside files importing its files
for (const [file, targets] of importsOf) {
  const from = ownerOf(file);
  for (const target of targets) {
    const to = ownerOf(target);
    if (!to || !from || to.id === from.id) continue;
    const key = to.id;
    if (!moduleOfImporters.has(key)) moduleOfImporters.set(key, new Map());
    const importers = moduleOfImporters.get(key);
    if (!importers.has(from.id)) importers.set(from.id, new Set());
    importers.get(from.id).add(file);
  }
}

const countLines = file => readFileSync(file, 'utf8').split('\n').length;

const analyze = mod => {
  const owned = sources.filter(file => ownerOf(file) === mod);
  const files = owned.map(file => {
    const rel = repoRelative(file);
    const outsideImporters = new Set();
    for (const importer of sources) {
      if (ownerOf(importer) === mod) continue;
      if (importsOf.get(importer).some(target => target === file)) outsideImporters.add(repoRelative(importer));
    }
    return { rel, lines: countLines(file), outsideImporters: [...outsideImporters].sort() };
  });
  const entrypoints = files.filter(f => f.outsideImporters.length > 0).sort((a, b) => b.outsideImporters.length - a.outsideImporters.length);
  const dependsOn = [...new Set(owned.flatMap(file => importsOf.get(file).map(target => ownerOf(target)?.id)).filter(id => id && id !== mod.id))].sort();
  const dependedOnBy = [...moduleOfImporters.get(mod.id)?.keys() ?? []].sort();
  const loc = files.reduce((sum, f) => sum + f.lines, 0);
  return { mod, files, entrypoints, dependsOn, dependedOnBy, loc };
};

// --- rendering ---------------------------------------------------------------

const render = ({ mod, files, entrypoints, dependsOn, dependedOnBy, loc }) => {
  const lines = [];
  lines.push(`# ${mod.id}`);
  lines.push('');
  lines.push(`**Role**: ${mod.role}  `);
  lines.push(`**Layer**: ${mod.layer}  `);
  lines.push(`**Size**: ${files.length} files, ${loc} lines`);
  if (mod.notes) lines.push(`**Notes**: ${mod.notes}`);
  lines.push('');

  lines.push('## Contract surface (files imported from outside the module)');
  lines.push('');
  if (entrypoints.length === 0) {
    lines.push('_None — the module is a leaf or its surface is entirely internal._');
  } else {
    lines.push('These files are the de-facto public API. Changing their signatures is a cross-module contract change:');
    lines.push('');
    for (const file of entrypoints) {
      lines.push(`- \`${file.rel}\` — imported by ${file.outsideImporters.length} outside file(s): ${file.outsideImporters.map(i => `\`${i}\``).join(', ')}`);
    }
  }
  lines.push('');

  lines.push('## Module edges');
  lines.push('');
  lines.push(`- Depends on: ${dependsOn.length ? dependsOn.map(d => `\`${d}\``).join(', ') : '_none_'}`);
  lines.push(`- Depended on by: ${dependedOnBy.length ? dependedOnBy.map(d => `\`${d}\``).join(', ') : '_none_'}`);
  lines.push('');

  lines.push('## Size pressure (largest files)');
  lines.push('');
  for (const file of [...files].sort((a, b) => b.lines - a.lines).slice(0, 5)) {
    const flag = file.lines > 800 ? ' ⚠️ over the 800-line ceiling (eslint max-lines)' : file.lines > 600 ? ' (approaching ceiling)' : '';
    lines.push(`- \`${file.rel}\` — ${file.lines} lines${flag}`);
  }
  lines.push('');

  lines.push('## Pinned by');
  lines.push('');
  for (const test of mod.tests) lines.push(`- \`${test}\``);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Generated by `pnpm run arch:context` from `scripts/module_registry.json` + the real import graph. Do not edit by hand; adjust the registry instead.');
  return lines.join('\n');
};

const outDir = join(ROOT, 'docs', 'generated', 'module-context');
mkdirSync(outDir, { recursive: true });

const targets = process.argv[2] ? modules.filter(m => m.id === process.argv[2]) : modules;
if (targets.length === 0) {
  console.error(`Unknown module id: ${process.argv[2]}. Known: ${modules.map(m => m.id).join(', ')}`);
  process.exit(1);
}

const summaries = [];
for (const mod of targets) {
  const report = analyze(mod);
  writeFileSync(join(outDir, `${mod.id.replaceAll('/', '_')}.md`), render(report));
  summaries.push({ id: mod.id, files: report.files.length, loc: report.loc, entrypoints: report.entrypoints.length });
}

if (!process.argv[2]) {
  const index = [
    '# Module context index',
    '',
    'Per-module bounded context lives beside this file. Regenerate with `pnpm run arch:context`.',
    '',
    '| Module | Layer | Files | LOC | Contract surface |',
    '|---|---|---|---|---|',
    ...summaries
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(s => `| \`${s.id}\` | ${modules.find(m => m.id === s.id).layer} | ${s.files} | ${s.loc} | ${s.entrypoints} |`),
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'index.md'), index);
}

for (const s of summaries) console.log(`${s.id}: ${s.files} files, ${s.loc} loc, ${s.entrypoints} contract files`);
