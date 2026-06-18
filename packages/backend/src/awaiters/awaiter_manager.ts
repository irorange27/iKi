import * as awaitersDb from '../db/awaiters';
import {
  DEFAULT_AWAITER_LIST_LIMIT,
  MAX_AWAITER_LIST_LIMIT,
  parseAwaiterTriggerSpec,
  type Awaiter,
  type AwaiterTriggerSpec,
} from '@iki/core/types/awaiters';
import { createPrefixedId } from '@iki/core/utils/id';
import { toIsoNow } from '@iki/core/utils/text';
import {
  computeAwaiterNextWakeAt,
  formatAwaiterTriggerSummary,
  normalizeAwaiterTriggerSpec,
  validateAwaiterTriggerSpec,
} from './awaiter_schedule';

export type AwaiterReference = {
  id?: string | null;
  title?: string | null;
};

export type AwaiterCreateInput = Omit<Partial<Awaiter>, 'trigger_spec_json'> &
  Pick<Awaiter, 'title' | 'instruction' | 'thread_id' | 'provider_type' | 'model'> & {
    trigger: AwaiterTriggerSpec | Record<string, unknown>;
  };

export type AwaiterUpdateInput = Omit<Partial<Awaiter>, 'trigger_spec_json'> & {
  trigger?: AwaiterTriggerSpec | Record<string, unknown>;
};

export type AwaiterRecord = Omit<Awaiter, 'trigger_spec_json' | 'resume_context_json'> & {
  trigger_spec: AwaiterTriggerSpec | null;
  trigger_summary: string;
};

const trimString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const clampListLimit = (value: unknown): number => {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) return DEFAULT_AWAITER_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_AWAITER_LIST_LIMIT, Math.trunc(asNumber)));
};

const normalizeProviderId = (value: unknown): string | null => {
  if (value === null) return null;
  const trimmed = trimString(value);
  return trimmed || null;
};

const normalizeNullableText = (value: unknown): string | null => {
  if (value === null || typeof value === 'undefined') return null;
  const trimmed = trimString(value);
  return trimmed || null;
};

const serializeTriggerSpec = (trigger: AwaiterTriggerSpec): string => JSON.stringify(trigger);

const toAwaiterRecord = (awaiter: Awaiter): AwaiterRecord => {
  const triggerSpec = parseAwaiterTriggerSpec(awaiter.trigger_spec_json, awaiter.trigger_kind);
  return {
    ...awaiter,
    provider_id: awaiter.provider_id ?? null,
    origin_run_id: awaiter.origin_run_id ?? null,
    origin_checkpoint_id: awaiter.origin_checkpoint_id ?? null,
    next_wake_at: awaiter.next_wake_at ?? null,
    last_wake_at: awaiter.last_wake_at ?? null,
    last_error: awaiter.last_error ?? null,
    expires_at: awaiter.expires_at ?? null,
    trigger_spec: triggerSpec,
    trigger_summary: formatAwaiterTriggerSummary(triggerSpec),
  };
};

const matchesQuery = (awaiter: Awaiter, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [
    awaiter.id,
    awaiter.title,
    awaiter.instruction,
    awaiter.status,
    awaiter.thread_id,
    awaiter.provider_type,
    awaiter.provider_id || '',
    awaiter.model,
  ]
    .join('\n')
    .toLowerCase()
    .includes(needle);
};

const resolveAwaiterByTitle = (title: string): Awaiter | null => {
  const needle = title.trim().toLowerCase();
  if (!needle) return null;

  const matches = awaitersDb
    .getAwaiters()
    .filter(awaiter => awaiter.title.trim().toLowerCase() === needle);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Multiple awaiters match title "${title}". Use awaiter id instead.`);
  }

  return matches[0];
};

export const resolveAwaiter = (reference: AwaiterReference): Awaiter | null => {
  const byId = trimString(reference.id);
  if (byId) {
    return awaitersDb.getAwaiter(byId);
  }

  const byTitle = trimString(reference.title);
  if (byTitle) {
    return resolveAwaiterByTitle(byTitle);
  }

  return null;
};

const normalizeTriggerOrThrow = (raw: unknown, nowIso: string): AwaiterTriggerSpec => {
  const trigger = normalizeAwaiterTriggerSpec(raw);
  if (!trigger) {
    throw new Error('Awaiter trigger is invalid');
  }

  const validationError = validateAwaiterTriggerSpec(trigger, nowIso);
  if (validationError) {
    throw new Error(`Invalid awaiter trigger: ${validationError}`);
  }

  return trigger;
};

export const createAwaiter = (input: AwaiterCreateInput): Awaiter => {
  const nowIso = toIsoNow();
  const id = trimString(input.id) || createPrefixedId('awaiter');
  const title = trimString(input.title);
  const instruction = trimString(input.instruction);
  const threadId = trimString(input.thread_id);
  const providerType = trimString(input.provider_type);
  const providerId = normalizeProviderId(input.provider_id);
  const model = trimString(input.model);
  const notify = input.notify !== false;
  const trigger = normalizeTriggerOrThrow(input.trigger, nowIso);

  if (!title) throw new Error('Awaiter title is required');
  if (!instruction) throw new Error('Awaiter instruction is required');
  if (!threadId) throw new Error('Awaiter thread_id is required');
  if (!providerType) throw new Error('Awaiter provider_type is required');
  if (!model) throw new Error('Awaiter model is required');

  awaitersDb.addAwaiter({
    id,
    title,
    instruction,
    status: 'armed',
    thread_id: threadId,
    origin_run_id: normalizeNullableText(input.origin_run_id),
    origin_checkpoint_id: normalizeNullableText(input.origin_checkpoint_id),
    trigger_kind: trigger.kind,
    trigger_spec_json: serializeTriggerSpec(trigger),
    delivery_mode: 'thread',
    notify,
    provider_type: providerType,
    provider_id: providerId,
    model,
    resume_context_json: normalizeNullableText(input.resume_context_json),
    next_wake_at: computeAwaiterNextWakeAt(trigger, nowIso),
    last_wake_at: null,
    last_error: null,
    expires_at: normalizeNullableText(input.expires_at),
  });

  const created = awaitersDb.getAwaiter(id);
  if (!created) {
    throw new Error('Failed to create awaiter');
  }
  return created;
};

export const updateAwaiter = (
  reference: AwaiterReference,
  updates: AwaiterUpdateInput
): Awaiter => {
  const existing = resolveAwaiter(reference);
  if (!existing) throw new Error('Awaiter not found');

  const nowIso = toIsoNow();
  const nextUpdates: Partial<Awaiter> = {};
  const hasTitle = Object.prototype.hasOwnProperty.call(updates, 'title');
  const hasInstruction = Object.prototype.hasOwnProperty.call(updates, 'instruction');
  const hasNotify = Object.prototype.hasOwnProperty.call(updates, 'notify');
  const hasThreadId = Object.prototype.hasOwnProperty.call(updates, 'thread_id');
  const hasProviderType = Object.prototype.hasOwnProperty.call(updates, 'provider_type');
  const hasProviderId = Object.prototype.hasOwnProperty.call(updates, 'provider_id');
  const hasModel = Object.prototype.hasOwnProperty.call(updates, 'model');
  const hasTrigger = Object.prototype.hasOwnProperty.call(updates, 'trigger');

  if (hasTitle) {
    const title = trimString(updates.title);
    if (!title) throw new Error('Awaiter title is required');
    nextUpdates.title = title;
  }
  if (hasInstruction) {
    const instruction = trimString(updates.instruction);
    if (!instruction) throw new Error('Awaiter instruction is required');
    nextUpdates.instruction = instruction;
  }
  if (hasNotify && typeof updates.notify === 'boolean') {
    nextUpdates.notify = updates.notify;
  }
  if (hasThreadId) {
    const threadId = trimString(updates.thread_id);
    if (!threadId) throw new Error('Awaiter thread_id is required');
    nextUpdates.thread_id = threadId;
  }
  if (hasProviderType) {
    const providerType = trimString(updates.provider_type);
    if (!providerType) throw new Error('Awaiter provider_type is required');
    nextUpdates.provider_type = providerType;
  }
  if (hasProviderId) {
    nextUpdates.provider_id = normalizeProviderId(updates.provider_id);
  }
  if (hasModel) {
    const model = trimString(updates.model);
    if (!model) throw new Error('Awaiter model is required');
    nextUpdates.model = model;
  }
  if (hasTrigger) {
    const trigger = normalizeTriggerOrThrow(updates.trigger, nowIso);
    nextUpdates.trigger_kind = trigger.kind;
    nextUpdates.trigger_spec_json = serializeTriggerSpec(trigger);
    nextUpdates.next_wake_at = computeAwaiterNextWakeAt(trigger, nowIso);
    if (existing.status !== 'armed') {
      nextUpdates.status = 'armed';
    }
    nextUpdates.last_error = null;
  }

  if (Object.keys(nextUpdates).length === 0) {
    throw new Error('No awaiter updates were provided');
  }

  awaitersDb.updateAwaiter(existing.id, nextUpdates);
  const updated = awaitersDb.getAwaiter(existing.id);
  if (!updated) {
    throw new Error('Failed to update awaiter');
  }
  return updated;
};

export const listAwaiterRecords = (params?: {
  query?: string;
  limit?: number;
}): AwaiterRecord[] => {
  const query = trimString(params?.query);
  const limit = clampListLimit(params?.limit);

  return awaitersDb
    .getAwaiters()
    .filter(awaiter => matchesQuery(awaiter, query))
    .slice(0, limit)
    .map(toAwaiterRecord);
};

export const readAwaiterRecord = (reference: AwaiterReference): AwaiterRecord | null => {
  const awaiter = resolveAwaiter(reference);
  return awaiter ? toAwaiterRecord(awaiter) : null;
};

export const deleteAwaiter = (
  reference: AwaiterReference
): { deleted: boolean; awaiterId: string | null; awaiterTitle: string | null } => {
  const awaiter = resolveAwaiter(reference);
  if (!awaiter) {
    return { deleted: false, awaiterId: null, awaiterTitle: null };
  }

  awaitersDb.deleteAwaiter(awaiter.id);
  return { deleted: true, awaiterId: awaiter.id, awaiterTitle: awaiter.title };
};

export const getAwaiterRecord = toAwaiterRecord;
