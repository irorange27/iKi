import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['packages/backend/src', 'packages/desktop/src', 'packages/daemon/src', 'tests'];
const files = [];
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.(ts|vue|mjs)$/.test(e.name)) files.push(p);
  }
};
roots.forEach(walk);

const configPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.');
const program = ts.createProgram(parsed.filePaths, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();

// collect all exported symbols declared in src files
const declared = new Map(); // symbol -> {file, name, kind}
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!sf.fileName.includes('/packages/')) continue;
  const mod = checker.getSymbolAtLocation(sf);
  if (!mod) continue;
  for (const sym of checker.getExportsOfModule(mod)) {
    const decls = sym.getDeclarations() ?? [];
    if (decls.length === 0) continue;
    const d = decls[0];
    if (!d.getSourceFile().fileName.includes('/packages/')) continue;
    if (!sf.fileName.includes('/src/')) continue;
    declared.set(sym, { file: path.relative('.', sf.fileName), name: sym.getName() });
  }
}

// now walk every identifier reference in the program
const used = new Set();
const visit = node => {
  if (ts.isIdentifier(node)) {
    const sym = checker.getSymbolAtLocation(node);
    if (sym) {
      const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      used.add(resolved);
      used.add(sym);
    }
  }
  ts.forEachChild(node, visit);
};
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  visit(sf);
}

const unused = [];
for (const [sym, info] of declared) {
  if (!used.has(sym)) unused.push(info);
}
unused.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
for (const u of unused) console.log(`${u.file} :: ${u.name}`);
console.log(`\n--- ${unused.length} unused exports ---`);
