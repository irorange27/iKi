#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HELPER_EXECUTABLE_NAMES = new Set([
  'chrome-sandbox',
  'crashpad_handler',
  'electron',
  'electron helper',
  'electron helper (gpu)',
  'electron helper (plugin)',
  'electron helper (renderer)',
  'squirrel',
  'update',
]);

const normalizeName = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const canonicalizeName = value => normalizeName(value).replace(/[^a-z0-9]+/g, '');

const unique = values => Array.from(new Set(values.filter(Boolean)));

const normalizeAppNames = ({ productName, packageName }) =>
  unique([normalizeName(productName), normalizeName(packageName)]);

const collectFiles = rootDir => {
  const stack = [rootDir];
  const files = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
};

const getMacAppBundleName = filePath => {
  const segments = filePath.split(path.sep);
  const appSegment = [...segments].reverse().find(segment => segment.toLowerCase().endsWith('.app'));
  return appSegment ? appSegment.slice(0, -4) : '';
};

const isHelperExecutable = filePath => {
  const executableName = path.basename(filePath, path.extname(filePath));
  return HELPER_EXECUTABLE_NAMES.has(normalizeName(executableName));
};

const scoreExecutable = ({ filePath, platform, candidateNames, candidateCanonicalNames }) => {
  if (isHelperExecutable(filePath)) return -1;

  const executableName = path.basename(filePath, path.extname(filePath));
  const executableCanonicalName = canonicalizeName(executableName);
  const bundleName = platform === 'darwin' ? getMacAppBundleName(filePath) : '';
  const bundleCanonicalName = canonicalizeName(bundleName);

  let score = 0;
  if (candidateCanonicalNames.has(executableCanonicalName)) score += 6;
  if (bundleCanonicalName && candidateCanonicalNames.has(bundleCanonicalName)) score += 8;

  const normalizedPath = normalizeName(filePath);
  for (const candidateName of candidateNames) {
    if (normalizedPath.includes(candidateName)) {
      score += 1;
    }
  }

  if (platform === 'darwin' && normalizedPath.includes('.app')) {
    score += 1;
  }

  return score;
};

const resolvePackagedExecutable = ({
  outDir,
  productName,
  packageName,
  platform = process.platform,
}) => {
  const resolvedOutDir = path.resolve(outDir || path.join(process.cwd(), 'out'));
  if (!fs.existsSync(resolvedOutDir)) {
    throw new Error(`Packaged output directory not found: ${resolvedOutDir}`);
  }

  const candidateNames = normalizeAppNames({ productName, packageName });
  const candidateCanonicalNames = new Set(candidateNames.map(canonicalizeName));
  const files = collectFiles(resolvedOutDir);
  const matchingExecutables = files
    .filter(filePath => {
      if (platform === 'darwin') {
        return filePath.includes(`${path.sep}.`) === false
          ? filePath.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`)
          : false;
      }
      if (platform === 'win32') {
        return path.extname(filePath).toLowerCase() === '.exe';
      }
      return path.extname(filePath) === '';
    })
    .map(filePath => ({
      filePath,
      score: scoreExecutable({
        filePath,
        platform,
        candidateNames,
        candidateCanonicalNames,
      }),
    }))
    .filter(entry => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  if (matchingExecutables.length === 0) {
    throw new Error(`No packaged executable found in ${resolvedOutDir}`);
  }

  return matchingExecutables[0].filePath;
};

const run = () => {
  const cwd = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const executablePath = resolvePackagedExecutable({
    outDir: process.argv[2],
    productName: manifest.productName || manifest.name,
    packageName: manifest.name,
    platform: process.platform,
  });

  const child = spawn(executablePath, {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.stdout.write(`Launched packaged preview: ${executablePath}\n`);
};

if (require.main === module) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  normalizeAppNames,
  resolvePackagedExecutable,
};
