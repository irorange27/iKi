import { getDb } from './database';
import type {
  RelationshipScopeType,
  RelationshipSourceKind,
  RelationshipStateRecord,
} from '../../shared/types/relationship';
import { createPrefixedId } from '../../shared/utils/id';

const nowIso = () => new Date().toISOString();

const normalizeScopeType = (value: unknown): RelationshipScopeType =>
  value === 'thread' ? 'thread' : 'thread';

const normalizeSourceKind = (value: unknown): RelationshipSourceKind => {
  if (
    value === 'desktop-owner-thread' ||
    value === 'napcat-private' ||
    value === 'napcat-group' ||
    value === 'external-client-thread' ||
    value === 'unknown-thread'
  ) {
    return value;
  }
  return 'unknown-thread';
};

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const normalizeRow = (
  row: RelationshipStateRecord | null | undefined
): RelationshipStateRecord | null => {
  if (!row) return null;
  return {
    ...row,
    scope_type: normalizeScopeType(row.scope_type),
    source_kind: normalizeSourceKind(row.source_kind),
    subject_label: normalizeText(row.subject_label),
    relationship_summary: normalizeText(row.relationship_summary),
    preferred_address: normalizeText(row.preferred_address),
    boundaries_json: normalizeOptionalText(row.boundaries_json),
    notes_json: normalizeOptionalText(row.notes_json),
    metadata: normalizeOptionalText(row.metadata),
    last_interaction_at: normalizeOptionalText(row.last_interaction_at),
  };
};

export const getRelationshipState = (
  profileId: string,
  scopeType: RelationshipScopeType,
  scopeId: string
): RelationshipStateRecord | null => {
  const normalizedProfileId = normalizeText(profileId);
  const normalizedScopeId = normalizeText(scopeId);
  if (!normalizedProfileId || !normalizedScopeId) return null;

  const row = getDb()
    .prepare(
      `
      SELECT * FROM relationship_states
      WHERE profile_id = ? AND scope_type = ? AND scope_id = ?
      LIMIT 1
    `
    )
    .get(normalizedProfileId, scopeType, normalizedScopeId) as RelationshipStateRecord | undefined;

  return normalizeRow(row);
};

export const listRelationshipStates = (params: {
  profileId: string;
  scopeType?: RelationshipScopeType;
  limit?: number;
}): RelationshipStateRecord[] => {
  const normalizedProfileId = normalizeText(params.profileId);
  if (!normalizedProfileId) return [];

  const normalizedLimit = Number.isFinite(params.limit)
    ? Math.max(1, Math.trunc(params.limit || 0))
    : 10;

  const rows = params.scopeType
    ? ((getDb()
        .prepare(
          `
          SELECT * FROM relationship_states
          WHERE profile_id = ? AND scope_type = ?
          ORDER BY COALESCE(last_interaction_at, updated_at) DESC, updated_at DESC
          LIMIT ?
        `
        )
        .all(normalizedProfileId, params.scopeType, normalizedLimit) as RelationshipStateRecord[]) ??
      [])
    : ((getDb()
        .prepare(
          `
          SELECT * FROM relationship_states
          WHERE profile_id = ?
          ORDER BY COALESCE(last_interaction_at, updated_at) DESC, updated_at DESC
          LIMIT ?
        `
        )
        .all(normalizedProfileId, normalizedLimit) as RelationshipStateRecord[]) ?? []);

  return rows.map(normalizeRow).filter(Boolean) as RelationshipStateRecord[];
};

export const upsertRelationshipState = (
  entry: Partial<RelationshipStateRecord> & {
    profile_id: string;
    scope_type: RelationshipScopeType;
    scope_id: string;
    source_kind: RelationshipSourceKind;
  }
): RelationshipStateRecord => {
  const profileId = normalizeText(entry.profile_id);
  const scopeId = normalizeText(entry.scope_id);
  if (!profileId || !scopeId) {
    throw new Error('profile_id and scope_id are required');
  }

  const existing = getRelationshipState(profileId, entry.scope_type, scopeId);
  const timestamp = nowIso();
  const id = existing?.id || normalizeText(entry.id) || createPrefixedId('relationship');
  const createdAt = existing?.created_at || entry.created_at || timestamp;

  getDb()
    .prepare(
      `
      INSERT INTO relationship_states (
        id,
        profile_id,
        scope_type,
        scope_id,
        source_kind,
        subject_label,
        relationship_summary,
        preferred_address,
        boundaries_json,
        notes_json,
        metadata,
        last_interaction_at,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @profile_id,
        @scope_type,
        @scope_id,
        @source_kind,
        @subject_label,
        @relationship_summary,
        @preferred_address,
        @boundaries_json,
        @notes_json,
        @metadata,
        @last_interaction_at,
        @created_at,
        @updated_at
      )
      ON CONFLICT(profile_id, scope_type, scope_id) DO UPDATE SET
        source_kind = excluded.source_kind,
        subject_label = excluded.subject_label,
        relationship_summary = excluded.relationship_summary,
        preferred_address = excluded.preferred_address,
        boundaries_json = excluded.boundaries_json,
        notes_json = excluded.notes_json,
        metadata = excluded.metadata,
        last_interaction_at = excluded.last_interaction_at,
        updated_at = excluded.updated_at
    `
    )
    .run({
      id,
      profile_id: profileId,
      scope_type: entry.scope_type,
      scope_id: scopeId,
      source_kind: normalizeSourceKind(entry.source_kind),
      subject_label: normalizeText(entry.subject_label),
      relationship_summary: normalizeText(entry.relationship_summary),
      preferred_address: normalizeText(entry.preferred_address),
      boundaries_json: normalizeOptionalText(entry.boundaries_json),
      notes_json: normalizeOptionalText(entry.notes_json),
      metadata: normalizeOptionalText(entry.metadata),
      last_interaction_at: normalizeOptionalText(entry.last_interaction_at),
      created_at: createdAt,
      updated_at: timestamp,
    });

  const reloaded = getRelationshipState(profileId, entry.scope_type, scopeId);
  if (!reloaded) {
    throw new Error('Failed to reload relationship state after upsert');
  }
  return reloaded;
};
