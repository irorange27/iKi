import { getDb } from './database';
import { createPrefixedId } from '../utils/id';
import { toIsoNow } from '../utils/text';
import { createHash } from 'node:crypto';

export type ClipboardSnapshotEntry = {
  id: string;
  content_hash: string;
  content_preview: string;
  content_length: number;
  mime_type: string;
  captured_at: string;
  created_at: string;
};

const MAX_SNAPSHOTS = 200;
const PREVIEW_MAX_LENGTH = 200;

const hashContent = (content: string): string => {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
};

const makePreview = (content: string): string => {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  return cleaned.length <= PREVIEW_MAX_LENGTH ? cleaned : cleaned.slice(0, PREVIEW_MAX_LENGTH) + '…';
};

export const addClipboardSnapshot = (entry: {
  content: string;
  mimeType?: string;
  capturedAt?: string;
}): ClipboardSnapshotEntry | null => {
  const { content, mimeType = 'text/plain' } = entry;
  if (!content || content.trim().length === 0) return null;

  const contentHash = hashContent(content);
  const now = toIsoNow();
  const capturedAt = entry.capturedAt || now;

  // Dedup: skip if the same hash was captured within the last 5 seconds
  const recent = getDb()
    .prepare(
      `SELECT id FROM clipboard_snapshots
       WHERE content_hash = ? AND captured_at > datetime(?, '-5 seconds')
       LIMIT 1`
    )
    .get(contentHash, capturedAt);
  if (recent) return null;

  const id = createPrefixedId('clip');
  const stmt = getDb().prepare(`
    INSERT INTO clipboard_snapshots (
      id, content_hash, content_preview, content_length, mime_type, captured_at, created_at
    ) VALUES (
      @id, @content_hash, @content_preview, @content_length, @mime_type, @captured_at, @created_at
    )
  `);

  stmt.run({
    id,
    content_hash: contentHash,
    content_preview: makePreview(content),
    content_length: content.length,
    mime_type: mimeType,
    captured_at: capturedAt,
    created_at: now,
  });

  return getClipboardSnapshot(id);
};

export const getClipboardSnapshot = (id: string): ClipboardSnapshotEntry | null => {
  return getDb()
    .prepare('SELECT * FROM clipboard_snapshots WHERE id = ?')
    .get(id) as ClipboardSnapshotEntry | null;
};

export const listRecentClipboardSnapshots = (limit = 20): ClipboardSnapshotEntry[] => {
  return getDb()
    .prepare(
      'SELECT * FROM clipboard_snapshots ORDER BY captured_at DESC LIMIT ?'
    )
    .all(limit) as ClipboardSnapshotEntry[];
};

export const listClipboardSnapshotsSince = (
  since: string,
  limit = 20
): ClipboardSnapshotEntry[] => {
  return getDb()
    .prepare(
      'SELECT * FROM clipboard_snapshots WHERE captured_at > ? ORDER BY captured_at DESC LIMIT ?'
    )
    .all(since, limit) as ClipboardSnapshotEntry[];
};

export const pruneClipboardSnapshots = (maxCount = MAX_SNAPSHOTS) => {
  return getDb()
    .prepare(
      `DELETE FROM clipboard_snapshots
       WHERE id IN (
         SELECT id FROM clipboard_snapshots
         ORDER BY captured_at DESC
         LIMIT -1 OFFSET ?
       )`
    )
    .run(maxCount);
};
