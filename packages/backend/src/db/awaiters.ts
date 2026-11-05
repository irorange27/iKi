import { commitRows, patchRow, readRows, removeRow } from './collection';
import type { Awaiter } from '@iki/backend/types/awaiters';
import { toIsoNow } from '@iki/backend/utils/text';

type AwaiterRow = Omit<Awaiter, 'notify'> & {
  notify: number | boolean;
};

const COLLECTION = 'awaiters';

const normalizeAwaiterRow = (row: AwaiterRow): Awaiter => ({
  ...row,
  notify: Boolean(row.notify),
});

const byUpdatedDesc = (a: AwaiterRow, b: AwaiterRow): number =>
  String(b.updated_at).localeCompare(String(a.updated_at));

export const getAwaiters = (): Awaiter[] =>
  readRows<AwaiterRow>(COLLECTION).sort(byUpdatedDesc).map(normalizeAwaiterRow);

export const getAwaiter = (id: string): Awaiter | null => {
  const row = readRows<AwaiterRow>(COLLECTION).find(entry => entry.id === id);
  return row ? normalizeAwaiterRow(row) : null;
};

export const listDueAwaiters = (now: string): Awaiter[] =>
  readRows<AwaiterRow>(COLLECTION)
    .filter(
      row =>
        (row.status === 'armed' || row.status === 'waking') &&
        typeof row.next_wake_at === 'string' &&
        row.next_wake_at <= now
    )
    .sort(
      (a, b) =>
        String(a.next_wake_at).localeCompare(String(b.next_wake_at)) ||
        String(b.updated_at).localeCompare(String(a.updated_at))
    )
    .map(normalizeAwaiterRow);

export const addAwaiter = (
  awaiter: Partial<Awaiter> & {
    id: string;
    title: string;
    instruction: string;
    thread_id: string;
    provider_type: string;
    model: string;
    trigger_kind: Awaiter['trigger_kind'];
    trigger_spec_json: string;
  }
) => {
  const now = toIsoNow();
  const row = {
    id: awaiter.id,
    title: awaiter.title,
    instruction: awaiter.instruction,
    status: awaiter.status ?? 'armed',
    thread_id: awaiter.thread_id,
    origin_run_id: awaiter.origin_run_id ?? null,
    origin_checkpoint_id: awaiter.origin_checkpoint_id ?? null,
    trigger_kind: awaiter.trigger_kind,
    trigger_spec_json: awaiter.trigger_spec_json,
    delivery_mode: awaiter.delivery_mode ?? 'thread',
    notify: awaiter.notify === false ? 0 : 1,
    provider_type: awaiter.provider_type,
    provider_id: awaiter.provider_id ?? null,
    model: awaiter.model,
    resume_context_json: awaiter.resume_context_json ?? null,
    next_wake_at: awaiter.next_wake_at ?? null,
    last_wake_at: awaiter.last_wake_at ?? null,
    last_error: awaiter.last_error ?? null,
    expires_at: awaiter.expires_at ?? null,
    created_at: now,
    updated_at: now,
  };
  const rows = readRows<AwaiterRow>(COLLECTION).filter(entry => entry.id !== awaiter.id);
  rows.push(row as unknown as AwaiterRow);
  commitRows(COLLECTION, rows);
  return { changes: 1, lastInsertRowid: 0 };
};

const AWAITER_COLUMNS = new Set([
  'title', 'instruction', 'status', 'thread_id', 'origin_run_id',
  'origin_checkpoint_id', 'trigger_kind', 'trigger_spec_json', 'delivery_mode',
  'notify', 'provider_type', 'provider_id', 'model', 'resume_context_json',
  'next_wake_at', 'last_wake_at', 'last_error', 'expires_at',
]);

const pickColumns = (updates: Partial<Awaiter>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(updates).filter(([key]) => AWAITER_COLUMNS.has(key)));

export const updateAwaiter = (id: string, updates: Partial<Awaiter>) => {
  const patch = pickColumns(updates);
  if (Object.keys(patch).length === 0) return null;
  const changes = patchRow<AwaiterRow>(COLLECTION, 'id', id, patch, AWAITER_COLUMNS);
  return { changes, lastInsertRowid: 0 };
};

export const reclaimStaleWakingAwaiters = (staleBefore: string): number => {
  const now = toIsoNow();
  const rows = readRows<AwaiterRow>(COLLECTION);
  let changed = 0;
  for (const row of rows) {
    if (row.status !== 'waking') continue;
    if (!(String(row.updated_at) < staleBefore)) continue;
    row.status = 'armed';
    row.last_error = 'Wake holder went silent; reclaimed by scheduler';
    row.updated_at = now;
    changed += 1;
  }
  if (changed > 0) commitRows(COLLECTION, rows);
  return changed;
};

export const updateAwaiterIfStatus = (
  id: string,
  expectedStatus: Awaiter['status'],
  updates: Partial<Awaiter>
) => {
  const rows = readRows<AwaiterRow>(COLLECTION);
  const index = rows.findIndex(row => row.id === id && row.status === expectedStatus);
  if (index < 0) return { changes: 0, lastInsertRowid: 0 };
  const patch = pickColumns(updates);
  Object.assign(rows[index] as Record<string, unknown>, patch, {
    updated_at: toIsoNow(),
  });
  if (typeof updates.notify === 'boolean') {
    (rows[index] as unknown as AwaiterRow).notify = updates.notify ? 1 : 0;
  }
  commitRows(COLLECTION, rows);
  return { changes: 1, lastInsertRowid: 0 };
};

export const deleteAwaiter = (id: string) => ({
  changes: removeRow<AwaiterRow>(COLLECTION, 'id', id),
  lastInsertRowid: 0,
});

export const deleteAwaitersByThread = (threadId: string) => {
  const rows = readRows<AwaiterRow>(COLLECTION);
  const kept = rows.filter(row => row.thread_id !== threadId);
  commitRows(COLLECTION, kept);
  return { changes: rows.length - kept.length, lastInsertRowid: 0 };
};
