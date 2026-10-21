import { getDb } from './database';
import type { Awaiter } from '@iki/backend/types/awaiters';
import { toIsoNow } from '@iki/backend/utils/text';
import { buildSetClause } from './utils';

type AwaiterRow = Omit<Awaiter, 'notify'> & {
  notify: number | boolean;
};

const normalizeAwaiterRow = (row: AwaiterRow): Awaiter => ({
  ...row,
  notify: Boolean(row.notify),
});

export const getAwaiters = (): Awaiter[] => {
  const rows = getDb()
    .prepare('SELECT * FROM awaiters ORDER BY updated_at DESC')
    .all() as AwaiterRow[];
  return rows.map(normalizeAwaiterRow);
};

export const getAwaiter = (id: string): Awaiter | null => {
  const row = getDb().prepare('SELECT * FROM awaiters WHERE id = ?').get(id) as
    | AwaiterRow
    | undefined;
  return row ? normalizeAwaiterRow(row) : null;
};

export const listDueAwaiters = (now: string): Awaiter[] => {
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM awaiters
      WHERE status IN ('armed', 'waking')
        AND next_wake_at IS NOT NULL
        AND next_wake_at <= ?
      ORDER BY next_wake_at ASC, updated_at DESC
    `
    )
    .all(now) as AwaiterRow[];
  return rows.map(normalizeAwaiterRow);
};

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
  return getDb()
    .prepare(
      `
      INSERT INTO awaiters (
        id,
        title,
        instruction,
        status,
        thread_id,
        origin_run_id,
        origin_checkpoint_id,
        trigger_kind,
        trigger_spec_json,
        delivery_mode,
        notify,
        provider_type,
        provider_id,
        model,
        resume_context_json,
        next_wake_at,
        last_wake_at,
        last_error,
        expires_at,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @title,
        @instruction,
        @status,
        @thread_id,
        @origin_run_id,
        @origin_checkpoint_id,
        @trigger_kind,
        @trigger_spec_json,
        @delivery_mode,
        @notify,
        @provider_type,
        @provider_id,
        @model,
        @resume_context_json,
        @next_wake_at,
        @last_wake_at,
        @last_error,
        @expires_at,
        @created_at,
        @updated_at
      )
    `
    )
    .run({
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
    });
};

const AWAITER_COLUMNS = new Set([
  'title', 'instruction', 'status', 'thread_id', 'origin_run_id',
  'origin_checkpoint_id', 'trigger_kind', 'trigger_spec_json', 'delivery_mode',
  'notify', 'provider_type', 'provider_id', 'model', 'resume_context_json',
  'next_wake_at', 'last_wake_at', 'last_error', 'expires_at',
]);

export const updateAwaiter = (id: string, updates: Partial<Awaiter>) => {
  const now = toIsoNow();
  const fields = buildSetClause(updates as Record<string, unknown>, AWAITER_COLUMNS);

  if (!fields) return null;

  const params: Record<string, unknown> = {
    ...updates,
    id,
    updated_at: now,
  };

  if (typeof updates.notify === 'boolean') {
    params.notify = updates.notify ? 1 : 0;
  }

  return getDb()
    .prepare(
      `
      UPDATE awaiters
      SET ${fields}, updated_at = @updated_at
      WHERE id = @id
    `
    )
    .run(params);
};

export const reclaimStaleWakingAwaiters = (staleBefore: string): number => {
  const now = toIsoNow();
  const result = getDb()
    .prepare(
      `
      UPDATE awaiters
      SET status = 'armed',
          last_error = 'Wake holder went silent; reclaimed by scheduler',
          updated_at = @updated_at
      WHERE status = 'waking'
        AND updated_at < @stale_before
    `
    )
    .run({ updated_at: now, stale_before: staleBefore });
  return result?.changes ?? 0;
};

export const updateAwaiterIfStatus = (
  id: string,
  expectedStatus: Awaiter['status'],
  updates: Partial<Awaiter>
) => {
  const now = toIsoNow();
  const fields = buildSetClause(updates as Record<string, unknown>, AWAITER_COLUMNS);

  if (!fields) return null;

  const params: Record<string, unknown> = {
    ...updates,
    id,
    updated_at: now,
  };

  if (typeof updates.notify === 'boolean') {
    params.notify = updates.notify ? 1 : 0;
  }

  return getDb()
    .prepare(
      `
      UPDATE awaiters
      SET ${fields}, updated_at = @updated_at
      WHERE id = @id
        AND status = @expected_status
    `
    )
    .run({
      ...params,
      expected_status: expectedStatus,
    });
};

export const deleteAwaiter = (id: string) =>
  getDb().prepare('DELETE FROM awaiters WHERE id = ?').run(id);

export const deleteAwaitersByThread = (threadId: string) =>
  getDb().prepare('DELETE FROM awaiters WHERE thread_id = ?').run(threadId);
