import fs from 'node:fs';
import path from 'node:path';
import { getUserDataPath } from '@iki/core/platform';
import type { SwarmBoardEntry, SwarmBoardEntryKind, SwarmRecord } from './types';

const BOARD_HEADER_VERSION = 1;

type BoardHeaderLine = { kind: 'header'; version: number; swarmId: string };
type BoardEntryLine = { kind: 'entry'; entry: SwarmBoardEntry };
type BoardJsonlLine = BoardHeaderLine | BoardEntryLine;

const WORKER_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const MENTION_REGEX = /(^|[\s([{"'`,:;!?])@([a-z0-9][a-z0-9_-]{0,23})\b/gi;

export const validateWorkerName = (name: string): string => {
  const normalized = name.trim();
  if (!WORKER_NAME_REGEX.test(normalized)) {
    throw new Error(
      `Invalid worker name "${name}". Use lowercase letters, digits, "-" or "_", starting with a letter or digit (max 24 chars).`
    );
  }
  if (
    normalized === 'all' ||
    normalized === 'coordinator' ||
    normalized.startsWith('coordinator-')
  ) {
    throw new Error(`Worker name "${normalized}" is reserved.`);
  }
  return normalized;
};

export const parseMentions = (
  text: string,
  knownNames: Iterable<string>
): { mentions: string[]; broadcastAll: boolean } => {
  const known = new Set(knownNames);
  const mentions: string[] = [];
  const seen = new Set<string>();
  let broadcastAll = false;

  for (const match of text.matchAll(MENTION_REGEX)) {
    const token = (match[2] ?? '').toLowerCase();
    if (!token) continue;
    if (token === 'all') {
      broadcastAll = true;
      continue;
    }
    if (known.has(token) && !seen.has(token)) {
      seen.add(token);
      mentions.push(token);
    }
  }

  return { mentions, broadcastAll };
};

const swarmsRootDir = (): string => {
  const dir = path.join(getUserDataPath(), 'swarms');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const swarmDirFor = (swarmId: string): string => path.join(swarmsRootDir(), encodeURIComponent(swarmId));

const rosterPathFor = (swarmId: string): string => path.join(swarmDirFor(swarmId), 'roster.json');

const boardPathFor = (swarmId: string): string => path.join(swarmDirFor(swarmId), 'board.jsonl');

const writeJsonAtomic = (filePath: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
};

const repairTornTail = (file: string): void => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!text || text.endsWith('\n')) return;
  const lastNewline = text.lastIndexOf('\n');
  fs.truncateSync(file, lastNewline + 1);
};

const readBoardFile = (file: string): SwarmBoardEntry[] => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries: SwarmBoardEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parsed: BoardJsonlLine;
    try {
      parsed = JSON.parse(line) as BoardJsonlLine;
    } catch {
      // Torn trailing line after a crash: discard partial tail and keep all prior committed posts.
      break;
    }
    if (parsed.kind === 'header') continue;
    if (parsed.kind === 'entry' && parsed.entry) {
      entries.push(parsed.entry);
    }
  }
  return entries;
};

export const saveSwarmRecord = (record: SwarmRecord): void => {
  record.updatedAt = new Date().toISOString();
  writeJsonAtomic(rosterPathFor(record.id), record);
};

export const loadSwarmRecord = (swarmId: string): SwarmRecord | null => {
  try {
    const raw = fs.readFileSync(rosterPathFor(swarmId), 'utf8');
    return JSON.parse(raw) as SwarmRecord;
  } catch {
    return null;
  }
};

export const listSwarmRecords = (): SwarmRecord[] => {
  const root = swarmsRootDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: SwarmRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const swarmId = decodeURIComponent(entry.name);
    const loaded = loadSwarmRecord(swarmId);
    if (loaded) records.push(loaded);
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const findSwarmRecordByThreadId = (threadId: string): SwarmRecord | null => {
  for (const record of listSwarmRecords()) {
    if (record.coordinatorThreadId === threadId) return record;
    for (const member of Object.values(record.members)) {
      if (member.threadId === threadId) return record;
    }
  }
  return null;
};

export const readBoardEntries = (
  swarmId: string,
  options?: { afterSeq?: number; limit?: number }
): SwarmBoardEntry[] => {
  const all = readBoardFile(boardPathFor(swarmId));
  const filtered =
    typeof options?.afterSeq === 'number'
      ? all.filter(entry => entry.seq > options.afterSeq!)
      : all;
  if (typeof options?.limit === 'number' && options.limit > 0 && filtered.length > options.limit) {
    return filtered.slice(-options.limit);
  }
  return filtered;
};

export const getBoardHeadSeq = (swarmId: string): number => {
  const all = readBoardFile(boardPathFor(swarmId));
  return all.at(-1)?.seq ?? 0;
};

export const appendBoardEntry = (params: {
  swarmId: string;
  sender: string;
  mentions: string[];
  kind: SwarmBoardEntryKind;
  content: string;
}): SwarmBoardEntry => {
  const file = boardPathFor(params.swarmId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    const header: BoardHeaderLine = {
      kind: 'header',
      version: BOARD_HEADER_VERSION,
      swarmId: params.swarmId,
    };
    fs.appendFileSync(file, `${JSON.stringify(header)}\n`, 'utf8');
  } else {
    repairTornTail(file);
  }

  const nextSeq = getBoardHeadSeq(params.swarmId) + 1;
  const entry: SwarmBoardEntry = {
    seq: nextSeq,
    swarmId: params.swarmId,
    createdAt: new Date().toISOString(),
    sender: params.sender,
    mentions: [...params.mentions],
    kind: params.kind,
    content: params.content,
  };
  const line: BoardEntryLine = { kind: 'entry', entry };
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`, 'utf8');
  return entry;
};
