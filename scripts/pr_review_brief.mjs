#!/usr/bin/env node
// Generates the review brief for a commit range (PR review protocol, see
// packages/backend/HARNESS_REVIEW.md): commits, changed files, full diff file,
// and risk-surface warnings. Usage:
//   node scripts/pr_review_brief.mjs [base...head]   (default: main...HEAD)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const range = process.argv[2] ?? 'main...HEAD';

const git = args =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const commits = git(['log', '--oneline', range]).trim();
const files = git(['diff', '--name-status', range]).trim();
const stat = git(['diff', '--stat', range]).trim();
const diff = git(['diff', range]);

const fileList = files
  .split('\n')
  .filter(Boolean)
  .map(line => line.split('\t').slice(1).join('\t'));
const backendSrc = fileList.filter(f => f.includes('packages/backend/src'));
const testFiles = fileList.filter(f => f.startsWith('tests/'));
const mapUpdated = fileList.some(f => f.endsWith('packages/backend/README.md'));

const lines = [];
lines.push(`# Review brief: ${range}`);
lines.push('');
lines.push('## Commits');
lines.push(commits || '(none)');
lines.push('');
lines.push('## Files');
lines.push(files || '(none)');
lines.push('');
lines.push('## Stat');
lines.push(stat || '(none)');
lines.push('');
lines.push('## Risk surface');
lines.push(`backend src files: ${backendSrc.length}`);
lines.push(`test files: ${testFiles.length}`);
lines.push(`ownership map (backend README) updated: ${mapUpdated}`);
if (backendSrc.length > 0 && testFiles.length === 0) {
  lines.push('WARNING: backend behavior changed with no test files in the diff');
}
if (backendSrc.length > 0 && !mapUpdated) {
  lines.push('WARNING: backend src changed without an ownership-map update');
}
if (commits.split('\n').length > 1 && testFiles.length > 0) {
  lines.push(
    'NOTE: multiple commits — the review of record must cover the range tip, not just the first commit'
  );
}
lines.push('');

console.log(lines.join('\n'));

const dir = mkdtempSync(join(tmpdir(), 'review-brief-'));
const diffPath = join(dir, 'diff.patch');
writeFileSync(diffPath, diff);
console.log(`Full diff written to: ${diffPath}`);
