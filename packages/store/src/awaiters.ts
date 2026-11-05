import { commitRows, patchRow, readRows, removeRow } from './collection';
import type { Awaiter } from '@iki/core/types/awaiters';
import { toIsoNow } from '@iki/core/utils/text';

const COLLECTION = 'awaiters';

// Legacy rows hold `notify` as 0/1; `!== false` maps both eras onto boolean.
const normalize = (row: Awaiter): Awaiter => ({
  ...row,
  notify: row.notify !== false,
});

const byUpdatedDesc = (a: Awaiter, b: Awaiter): number =>
  String(b.updated_at).localeCompare(String(a.updated_at));

export const getAwaiters = (): Awaiter[] =>
  readRows<Awaiter>(COLLECTION).sort(byUpdatedDesc).map(normalize);

export const getAwaiter = (id: string): Awaiter | null => {
  const row = readRows<Awaiter>(COLLECTION).find(entry => entry.id === id);
  return row ? normalize(row) : null;
};

export const listDueAwaiters = (now: string): Awaiter[] =>
  readRows<Awaiter>(COLLECTION)
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
    .map(normalize);

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
): void => {
  const now = toIsoNow();
  const row: Awaiter = {
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
    notify: awaiter.notify !== false,
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
  const rows = readRows<Awaiter>(COLLECTION).filter(entry => entry.id !== awaiter.id);
  rows.push(row);
  commitRows(COLLECTION, rows);
};

/** Apply a partial update. `null` when nothing was given or the awaiter is gone. */
export const updateAwaiter = (id: string, updates: Partial<Awaiter>): Awaiter | null => {
  const { id: _immutable, ...changes } = updates;
  void _immutable;
  if (Object.keys(changes).length === 0) return null;
  if (!patchRow<Awaiter>(COLLECTION, 'id', id, changes)) return null;
  return getAwaiter(id);
};

/** Re-arm awaiters whose wake holder went silent. Returns how many were reclaimed. */
export const reclaimStaleWakingAwaiters = (staleBefore: string): number => {
  const now = toIsoNow();
  const rows = readRows<Awaiter>(COLLECTION);
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

/**
 * Compare-and-set: apply the update only while the awaiter still has the
 * expected status. `true` means this caller won the claim.
 */
export const updateAwaiterIfStatus = (
  id: string,
  expectedStatus: Awaiter['status'],
  updates: Partial<Awaiter>
): boolean => {
  const rows = readRows<Awaiter>(COLLECTION);
  const index = rows.findIndex(row => row.id === id && row.status === expectedStatus);
  if (index < 0) return false;
  const { id: _immutable, ...changes } = updates;
  void _immutable;
  Object.assign(rows[index] as unknown as Record<string, unknown>, changes, { updated_at: toIsoNow() });
  commitRows(COLLECTION, rows);
  return true;
};

export const deleteAwaiter = (id: string): void => {
  removeRow<Awaiter>(COLLECTION, 'id', id);
};

/** Remove every awaiter of a thread. Returns how many were dropped. */
export const deleteAwaitersByThread = (threadId: string): number => {
  const rows = readRows<Awaiter>(COLLECTION);
  const kept = rows.filter(row => row.thread_id !== threadId);
  commitRows(COLLECTION, kept);
  return rows.length - kept.length;
};
