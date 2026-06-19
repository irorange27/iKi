import { getDb } from './database';
import type {
  AssistantProfileRecord,
  ContinuityEvidenceRecord,
  ContinuityItemKind,
  ContinuityItemRecord,
  ContinuityItemScope,
  ContinuityItemSourceKind,
  ContinuityItemStatus,
  ContinuitySearchResult,
} from '@iki/backend/types/continuity';
import { createPrefixedId } from '@iki/core/utils/id';
import {
  normalizeOptionalWhitespace,
  normalizeWhitespace,
  toIsoNow,
} from '@iki/core/utils/text';

const clampUnit = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

const normalizeContinuityKind = (value: unknown): ContinuityItemKind => {
  if (
    value === 'owner_fact' ||
    value === 'preference' ||
    value === 'boundary' ||
    value === 'project' ||
    value === 'person' ||
    value === 'workflow_rule' ||
    value === 'reference_note'
  ) {
    return value;
  }
  return 'reference_note';
};

const normalizeContinuityStatus = (value: unknown): ContinuityItemStatus => {
  if (value === 'candidate' || value === 'confirmed' || value === 'dismissed' || value === 'stale') {
    return value;
  }
  return 'candidate';
};

const normalizeContinuityScope = (value: unknown): ContinuityItemScope => {
  if (value === 'global' || value === 'project' || value === 'person' || value === 'workspace') {
    return value;
  }
  return 'global';
};

const normalizeSourceKind = (value: unknown): ContinuityItemSourceKind => {
  if (value === 'manual' || value === 'explicit_message' || value === 'imported' || value === 'merged') {
    return value;
  }
  return 'manual';
};

const tokenize = (value: string): string[] =>
  normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 2);

const overlapScore = (query: string, target: string): number => {
  const queryTokens = tokenize(query);
  const targetTokens = tokenize(target);
  if (!queryTokens.length || !targetTokens.length) return 0;

  const targetSet = new Set(targetTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (targetSet.has(token)) hits += 1;
  }

  if (hits === 0) return 0;

  const normalizedTarget = normalizeWhitespace(target).toLowerCase();
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const exactBoost = normalizedTarget.includes(normalizedQuery) ? 0.25 : 0;

  return Math.min(1, hits / queryTokens.length + exactBoost);
};

const normalizeAssistantProfileRow = (
  row: AssistantProfileRecord | null | undefined
): AssistantProfileRecord | null => {
  if (!row) return null;
  return {
    ...row,
    display_name: normalizeWhitespace(row.display_name),
    role_summary: normalizeWhitespace(row.role_summary),
    owner_display_name: normalizeWhitespace(row.owner_display_name),
    tone_guidance: normalizeWhitespace(row.tone_guidance),
    hard_boundaries_json: normalizeOptionalWhitespace(row.hard_boundaries_json),
    collaboration_style_json: normalizeOptionalWhitespace(row.collaboration_style_json),
    metadata_json: normalizeOptionalWhitespace(row.metadata_json),
  };
};

const normalizeContinuityItemRow = (
  row: ContinuityItemRecord | null | undefined
): ContinuityItemRecord | null => {
  if (!row) return null;
  return {
    ...row,
    kind: normalizeContinuityKind(row.kind),
    title: normalizeWhitespace(row.title),
    summary: normalizeWhitespace(row.summary),
    status: normalizeContinuityStatus(row.status),
    confidence: clampUnit(row.confidence, 0),
    priority: clampUnit(row.priority, 0),
    scope: normalizeContinuityScope(row.scope),
    subject_key: normalizeOptionalWhitespace(row.subject_key),
    source_kind: normalizeSourceKind(row.source_kind),
    source_ref: normalizeOptionalWhitespace(row.source_ref),
    first_seen_at: normalizeOptionalWhitespace(row.first_seen_at),
    last_confirmed_at: normalizeOptionalWhitespace(row.last_confirmed_at),
    last_used_at: normalizeOptionalWhitespace(row.last_used_at),
    metadata_json: normalizeOptionalWhitespace(row.metadata_json),
  };
};

export const getAssistantProfileByProfileId = (profileId: string): AssistantProfileRecord | null => {
  const normalizedProfileId = normalizeWhitespace(profileId);
  if (!normalizedProfileId) return null;

  const row = getDb()
    .prepare('SELECT * FROM assistant_profiles WHERE profile_id = ? LIMIT 1')
    .get(normalizedProfileId) as AssistantProfileRecord | undefined;

  return normalizeAssistantProfileRow(row);
};

export const upsertAssistantProfile = (
  entry: Partial<AssistantProfileRecord> & {
    profile_id: string;
    display_name: string;
  }
): AssistantProfileRecord => {
  const profileId = normalizeWhitespace(entry.profile_id);
  const displayName = normalizeWhitespace(entry.display_name);
  if (!profileId || !displayName) {
    throw new Error('profile_id and display_name are required');
  }

  const existing = getAssistantProfileByProfileId(profileId);
  const timestamp = toIsoNow();
  const id = existing?.id || normalizeWhitespace(entry.id) || createPrefixedId('assistant');
  const createdAt = existing?.created_at || entry.created_at || timestamp;

  getDb()
    .prepare(
      `
      INSERT INTO assistant_profiles (
        id,
        profile_id,
        display_name,
        role_summary,
        owner_display_name,
        tone_guidance,
        hard_boundaries_json,
        collaboration_style_json,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @profile_id,
        @display_name,
        @role_summary,
        @owner_display_name,
        @tone_guidance,
        @hard_boundaries_json,
        @collaboration_style_json,
        @metadata_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(profile_id) DO UPDATE SET
        display_name = excluded.display_name,
        role_summary = excluded.role_summary,
        owner_display_name = excluded.owner_display_name,
        tone_guidance = excluded.tone_guidance,
        hard_boundaries_json = excluded.hard_boundaries_json,
        collaboration_style_json = excluded.collaboration_style_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `
    )
    .run({
      id,
      profile_id: profileId,
      display_name: displayName,
      role_summary: normalizeWhitespace(entry.role_summary),
      owner_display_name: normalizeWhitespace(entry.owner_display_name),
      tone_guidance: normalizeWhitespace(entry.tone_guidance),
      hard_boundaries_json: normalizeOptionalWhitespace(entry.hard_boundaries_json),
      collaboration_style_json: normalizeOptionalWhitespace(entry.collaboration_style_json),
      metadata_json: normalizeOptionalWhitespace(entry.metadata_json),
      created_at: createdAt,
      updated_at: timestamp,
    });

  const reloaded = getAssistantProfileByProfileId(profileId);
  if (!reloaded) {
    throw new Error('Failed to reload assistant profile after upsert');
  }
  return reloaded;
};

export const getContinuityItemById = (id: string): ContinuityItemRecord | null => {
  const normalizedId = normalizeWhitespace(id);
  if (!normalizedId) return null;
  const row = getDb()
    .prepare('SELECT * FROM continuity_items WHERE id = ? LIMIT 1')
    .get(normalizedId) as ContinuityItemRecord | undefined;
  return normalizeContinuityItemRow(row);
};

export const getContinuityItemBySourceRef = (
  profileId: string,
  sourceRef: string
): ContinuityItemRecord | null => {
  const normalizedProfileId = normalizeWhitespace(profileId);
  const normalizedSourceRef = normalizeWhitespace(sourceRef);
  if (!normalizedProfileId || !normalizedSourceRef) return null;

  const row = getDb()
    .prepare(
      `
      SELECT * FROM continuity_items
      WHERE profile_id = ? AND source_ref = ?
      LIMIT 1
    `
    )
    .get(normalizedProfileId, normalizedSourceRef) as ContinuityItemRecord | undefined;

  return normalizeContinuityItemRow(row);
};

export const findContinuityItemByExactSummary = (params: {
  profileId: string;
  kind: ContinuityItemKind;
  summary: string;
}): ContinuityItemRecord | null => {
  const normalizedProfileId = normalizeWhitespace(params.profileId);
  const normalizedSummary = normalizeWhitespace(params.summary);
  if (!normalizedProfileId || !normalizedSummary) return null;

  const row = getDb()
    .prepare(
      `
      SELECT * FROM continuity_items
      WHERE profile_id = ? AND kind = ? AND summary = ?
      ORDER BY
        CASE status WHEN 'confirmed' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,
        updated_at DESC
      LIMIT 1
    `
    )
    .get(normalizedProfileId, params.kind, normalizedSummary) as ContinuityItemRecord | undefined;

  return normalizeContinuityItemRow(row);
};

export const listContinuityItems = (params: {
  profileId: string;
  status?: ContinuityItemStatus | ContinuityItemStatus[];
  limit?: number;
}): ContinuityItemRecord[] => {
  const normalizedProfileId = normalizeWhitespace(params.profileId);
  if (!normalizedProfileId) return [];

  const normalizedLimit = Number.isFinite(params.limit) ? Math.max(1, Math.trunc(params.limit || 0)) : 50;
  const statuses = Array.isArray(params.status)
    ? params.status.map(normalizeContinuityStatus)
    : params.status
      ? [normalizeContinuityStatus(params.status)]
      : [];

  const where: string[] = ['profile_id = ?'];
  const values: unknown[] = [normalizedProfileId];

  if (statuses.length > 0) {
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    values.push(...statuses);
  }

  const rows = getDb()
    .prepare(
      `
      SELECT * FROM continuity_items
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE status WHEN 'confirmed' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,
        updated_at DESC
      LIMIT ?
    `
    )
    .all(...values, normalizedLimit) as ContinuityItemRecord[];

  return rows.map(normalizeContinuityItemRow).filter(Boolean) as ContinuityItemRecord[];
};

export const upsertContinuityItem = (
  entry: Partial<ContinuityItemRecord> & {
    profile_id: string;
    kind: ContinuityItemKind;
    title: string;
    summary: string;
    source_kind: ContinuityItemSourceKind;
  }
): ContinuityItemRecord => {
  const profileId = normalizeWhitespace(entry.profile_id);
  const title = normalizeWhitespace(entry.title);
  const summary = normalizeWhitespace(entry.summary);
  if (!profileId || !title || !summary) {
    throw new Error('profile_id, title, and summary are required');
  }

  const existing =
    (entry.source_ref ? getContinuityItemBySourceRef(profileId, entry.source_ref) : null) ||
    (entry.id ? getContinuityItemById(entry.id) : null);
  const timestamp = toIsoNow();
  const id = existing?.id || normalizeWhitespace(entry.id) || createPrefixedId('continuity');
  const createdAt = existing?.created_at || entry.created_at || timestamp;

  getDb()
    .prepare(
      `
      INSERT INTO continuity_items (
        id,
        profile_id,
        kind,
        title,
        summary,
        status,
        confidence,
        priority,
        scope,
        subject_key,
        source_kind,
        source_ref,
        first_seen_at,
        last_confirmed_at,
        last_used_at,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @profile_id,
        @kind,
        @title,
        @summary,
        @status,
        @confidence,
        @priority,
        @scope,
        @subject_key,
        @source_kind,
        @source_ref,
        @first_seen_at,
        @last_confirmed_at,
        @last_used_at,
        @metadata_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        confidence = excluded.confidence,
        priority = excluded.priority,
        scope = excluded.scope,
        subject_key = excluded.subject_key,
        source_kind = excluded.source_kind,
        source_ref = excluded.source_ref,
        first_seen_at = excluded.first_seen_at,
        last_confirmed_at = excluded.last_confirmed_at,
        last_used_at = excluded.last_used_at,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `
    )
    .run({
      id,
      profile_id: profileId,
      kind: normalizeContinuityKind(entry.kind),
      title,
      summary,
      status: normalizeContinuityStatus(entry.status),
      confidence: clampUnit(entry.confidence, existing?.confidence ?? 0),
      priority: clampUnit(entry.priority, existing?.priority ?? 0),
      scope: normalizeContinuityScope(entry.scope),
      subject_key: normalizeOptionalWhitespace(entry.subject_key),
      source_kind: normalizeSourceKind(entry.source_kind),
      source_ref: normalizeOptionalWhitespace(entry.source_ref),
      first_seen_at: normalizeOptionalWhitespace(entry.first_seen_at) || existing?.first_seen_at || timestamp,
      last_confirmed_at: normalizeOptionalWhitespace(entry.last_confirmed_at) || existing?.last_confirmed_at,
      last_used_at: normalizeOptionalWhitespace(entry.last_used_at) || existing?.last_used_at,
      metadata_json: normalizeOptionalWhitespace(entry.metadata_json),
      created_at: createdAt,
      updated_at: timestamp,
    });

  const reloaded = getContinuityItemById(id);
  if (!reloaded) {
    throw new Error('Failed to reload continuity item after upsert');
  }
  return reloaded;
};

export const addContinuityEvidence = (
  entry: Omit<ContinuityEvidenceRecord, 'id' | 'created_at'> & {
    id?: string;
    created_at?: string;
  }
): ContinuityEvidenceRecord => {
  const itemId = normalizeWhitespace(entry.item_id);
  const excerpt = normalizeWhitespace(entry.excerpt);
  const extractorVersion = normalizeWhitespace(entry.extractor_version);
  if (!itemId || !excerpt || !extractorVersion) {
    throw new Error('item_id, excerpt, and extractor_version are required');
  }

  const timestamp = entry.created_at || toIsoNow();
  const id = normalizeWhitespace(entry.id) || createPrefixedId('evidence');

  getDb()
    .prepare(
      `
      INSERT INTO continuity_evidence (
        id,
        item_id,
        thread_id,
        message_id,
        excerpt,
        extractor_version,
        created_at
      ) VALUES (
        @id,
        @item_id,
        @thread_id,
        @message_id,
        @excerpt,
        @extractor_version,
        @created_at
      )
    `
    )
    .run({
      id,
      item_id: itemId,
      thread_id: normalizeOptionalWhitespace(entry.thread_id),
      message_id: normalizeOptionalWhitespace(entry.message_id),
      excerpt,
      extractor_version: extractorVersion,
      created_at: timestamp,
    });

  return {
    id,
    item_id: itemId,
    thread_id: normalizeOptionalWhitespace(entry.thread_id),
    message_id: normalizeOptionalWhitespace(entry.message_id),
    excerpt,
    extractor_version: extractorVersion,
    created_at: timestamp,
  };
};

const getContinuityEvidenceCounts = (itemIds: string[]): Map<string, number> => {
  if (itemIds.length === 0) return new Map();
  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `
      SELECT item_id, COUNT(*) AS evidence_count
      FROM continuity_evidence
      WHERE item_id IN (${placeholders})
      GROUP BY item_id
    `
    )
    .all(...itemIds) as Array<{ item_id: string; evidence_count: number }>;

  return rows.reduce((map, row) => {
    map.set(row.item_id, Number(row.evidence_count || 0));
    return map;
  }, new Map<string, number>());
};

export const searchContinuityItems = (params: {
  profileId: string;
  query: string;
  limit?: number;
  statuses?: ContinuityItemStatus[];
}): ContinuitySearchResult[] => {
  const candidates = listContinuityItems({
    profileId: params.profileId,
    status: params.statuses ?? ['confirmed'],
    limit: Math.max(50, (params.limit ?? 6) * 5),
  });
  const scored = candidates
    .map(item => ({
      item,
      score:
        overlapScore(params.query, `${item.title} ${item.summary} ${item.subject_key || ''}`) * 0.85 +
        item.priority * 0.1 +
        item.confidence * 0.05,
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, params.limit ?? 6));

  const evidenceCounts = getContinuityEvidenceCounts(scored.map(entry => entry.item.id));
  return scored.map(entry => ({
    ...entry.item,
    score: Number(entry.score.toFixed(3)),
    evidence_count: evidenceCounts.get(entry.item.id) || 0,
  }));
};

export const touchContinuityItems = (itemIds: string[], atIso?: string): void => {
  const normalizedIds = itemIds.map(id => normalizeWhitespace(id)).filter(Boolean);
  if (normalizedIds.length === 0) return;
  const timestamp = normalizeWhitespace(atIso) || toIsoNow();
  const placeholders = normalizedIds.map(() => '?').join(', ');
  getDb()
    .prepare(
      `
      UPDATE continuity_items
      SET last_used_at = ?, updated_at = updated_at
      WHERE id IN (${placeholders})
    `
    )
    .run(timestamp, ...normalizedIds);
};
