import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

import type { SkillSummary, SkillSource } from '../../shared/types/skill';
import { getUserDataPath } from '../platform';

type SkillRecord = SkillSummary & {
  filePath: string;
};

const SKILL_FILENAME = 'SKILL.md';

const MAX_SCAN_DEPTH = 8;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
]);

const normalizeIdPath = (value: string): string =>
  value
    .replaceAll(path.sep, '/')
    .replace(/^\.\/+/, '')
    .trim();

const getCodexHome = (): string => {
  const env = process.env.CODEX_HOME;
  if (typeof env === 'string' && env.trim()) return env.trim();
  return path.join(os.homedir(), '.codex');
};

const getSkillRootsInternal = (): Array<{ source: SkillSource; root: string }> => {
  const roots: Array<{ source: SkillSource; root: string }> = [];

  roots.push({
    source: 'user',
    root: path.join(getUserDataPath(), 'skills'),
  });

  roots.push({
    source: 'codex',
    root: path.join(getCodexHome(), 'skills'),
  });

  return roots;
};

export const getSkillRootsForUi = (): Array<{ source: SkillSource; path: string }> => {
  return getSkillRootsInternal().map(root => ({ source: root.source, path: root.root }));
};

const normalizeSummaryText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const extractFrontmatter = (raw: string): { metadata: string; body: string } | null => {
  const normalized = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!match) return null;
  return {
    metadata: match[1] || '',
    body: normalized.slice(match[0].length),
  };
};

const parseQuotedFrontmatterValue = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : trimmed.slice(1, -1);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
};

const parseSkillFrontmatter = (raw: string): { name: string; description: string } => {
  const lines = raw.split(/\r?\n/);
  let name = '';
  let description = '';

  const assignField = (key: 'name' | 'description', value: string) => {
    const normalized = normalizeSummaryText(value);
    if (!normalized) return;
    if (key === 'name' && !name) name = normalized;
    if (key === 'description' && !description) description = normalized;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    if (!line || /^\s/.test(line)) continue;

    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) continue;

    const [, keyRaw, remainderRaw] = match;
    const key = keyRaw === 'name' || keyRaw === 'description' ? keyRaw : null;
    if (!key) continue;

    const remainder = remainderRaw.trim();
    if (/^[>|][-+0-9]*$/.test(remainder)) {
      const blockLines: string[] = [];
      let blockIndent: number | null = null;
      let nextIndex = i + 1;

      for (; nextIndex < lines.length; nextIndex += 1) {
        const nextLine = lines[nextIndex] || '';
        if (!nextLine.trim()) {
          if (blockIndent !== null) blockLines.push('');
          continue;
        }

        const indent = nextLine.match(/^[ \t]*/)?.[0].length ?? 0;
        if (indent === 0) break;
        if (blockIndent === null) blockIndent = indent;
        blockLines.push(nextLine.slice(Math.min(indent, blockIndent)).trimEnd());
      }

      assignField(key, blockLines.join(remainder.startsWith('|') ? '\n' : ' '));
      i = nextIndex - 1;
      continue;
    }

    assignField(key, parseQuotedFrontmatterValue(remainder));
  }

  return { name, description };
};

const extractMarkdownTitleAndDescription = (
  raw: string
): { title: string; description: string } => {
  const lines = raw.split(/\r?\n/);
  let title = '';
  let description = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] || '').trim();
    if (!line) continue;

    if (!title && line.startsWith('#')) {
      title = line.replace(/^#+\s*/, '').trim();
      continue;
    }

    if (!description && !line.startsWith('#')) {
      description = normalizeSummaryText(line);
      break;
    }
  }

  return { title, description };
};

const extractTitleAndDescription = (raw: string): { title: string; description: string } => {
  const frontmatter = extractFrontmatter(raw);
  const markdown = extractMarkdownTitleAndDescription(frontmatter?.body || raw);
  const metadata = frontmatter
    ? parseSkillFrontmatter(frontmatter.metadata)
    : { name: '', description: '' };

  return {
    title: markdown.title || metadata.name,
    description: metadata.description || markdown.description,
  };
};

const safeReadTextFile = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
};

const walkForSkillFiles = async (dir: string, depth: number, out: string[]): Promise<void> => {
  if (depth > MAX_SCAN_DEPTH) return;

  let entries: Array<import('node:fs').Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkForSkillFiles(fullPath, depth + 1, out);
    } else if (entry.isFile() && entry.name === SKILL_FILENAME) {
      out.push(fullPath);
    }
  }
};

const buildRecordId = (source: SkillSource, root: string, filePath: string): string => {
  const skillDir = path.dirname(filePath);
  const relative = normalizeIdPath(path.relative(root, skillDir)) || '.';
  return `${source}:${relative}`;
};

const filePathToNameFallback = (filePath: string): string =>
  path.basename(path.dirname(filePath)) || 'skill';

export const normalizeSkillIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const results: string[] = [];

  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push(id);
    if (results.length >= 32) break;
  }

  return results;
};

let cachedRecords: SkillRecord[] | null = null;
let cachedAtMs = 0;
const CACHE_TTL_MS = 5_000;

const listSkillRecords = async (options?: { forceRefresh?: boolean }): Promise<SkillRecord[]> => {
  const forceRefresh = options?.forceRefresh === true;
  const now = Date.now();
  if (!forceRefresh && cachedRecords && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedRecords;
  }

  const roots = getSkillRootsInternal();
  const records: SkillRecord[] = [];
  const seenIds = new Set<string>();

  for (const { source, root } of roots) {
    if (!existsSync(root)) continue;

    const skillFiles: string[] = [];
    await walkForSkillFiles(root, 0, skillFiles);

    for (const filePath of skillFiles) {
      const id = buildRecordId(source, root, filePath);
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const snippet = await safeReadTextFile(filePath);
      const { title, description } = extractTitleAndDescription(snippet.slice(0, 8000));
      const name = title || filePathToNameFallback(filePath);

      records.push({
        id,
        name,
        description: description || '',
        source,
        filePath,
      });
    }
  }

  records.sort((a, b) => a.name.localeCompare(b.name));

  cachedRecords = records;
  cachedAtMs = now;
  return records;
};

export const listSkills = async (options?: { forceRefresh?: boolean }): Promise<SkillSummary[]> => {
  const records = await listSkillRecords({ forceRefresh: options?.forceRefresh === true });
  return records.map(record => ({
    id: record.id,
    name: record.name,
    description: record.description,
    source: record.source,
    path: path.dirname(record.filePath),
  }));
};

const getSkillRecordById = async (id: string): Promise<SkillRecord | null> => {
  const records = await listSkillRecords();
  const found = records.find(record => record.id === id);
  return found || null;
};

const truncateText = (value: string, maxChars: number): { text: string; truncated: boolean } => {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return { text: `${value.slice(0, maxChars)}...`, truncated: true };
};

export const readSkillContent = async (
  id: string,
  options?: { maxChars?: number }
): Promise<{
  id: string;
  name: string;
  source: SkillSource;
  filePath: string;
  content: string;
  truncated: boolean;
} | null> => {
  const record = await getSkillRecordById(id);
  if (!record) return null;
  const raw = await safeReadTextFile(record.filePath);
  const maxChars =
    typeof options?.maxChars === 'number' && Number.isFinite(options.maxChars)
      ? Math.max(200, Math.trunc(options.maxChars))
      : 20000;
  const truncated = truncateText(raw, maxChars);
  return {
    id: record.id,
    name: record.name,
    source: record.source,
    filePath: record.filePath,
    content: truncated.text,
    truncated: truncated.truncated,
  };
};

export const getSkillFolderPath = async (id: string): Promise<string | null> => {
  const record = await getSkillRecordById(id);
  if (!record) return null;
  return path.dirname(record.filePath);
};

export const buildSkillsSystemPrompt = async (skillIds: string[]): Promise<string> => {
  const ids = normalizeSkillIds(skillIds);
  if (ids.length === 0) return '';

  const MAX_SKILL_CHARS = 12000;
  const MAX_TOTAL_CHARS = 40000;

  const parts: string[] = [];
  let totalChars = 0;
  let totalTruncated = false;
  for (const id of ids) {
    const record = await getSkillRecordById(id);
    if (!record) continue;
    const content = await safeReadTextFile(record.filePath);
    const trimmed = content.trim();
    if (!trimmed) continue;

    const clipped = truncateText(trimmed, MAX_SKILL_CHARS);
    let chunk = `SKILL: ${record.name} (${id})\n${clipped.text.trim()}`;
    if (clipped.truncated) {
      chunk += '\n\n[Skill content truncated]';
    }

    const nextLen = chunk.length + (parts.length > 0 ? 2 : 0);
    if (totalChars + nextLen > MAX_TOTAL_CHARS) {
      totalTruncated = true;
      break;
    }

    parts.push(chunk);
    totalChars += nextLen;
  }

  if (parts.length === 0) return '';
  const built = parts.join('\n\n');
  return totalTruncated ? `${built}\n\n[Additional skills omitted due to size limits]` : built;
};
