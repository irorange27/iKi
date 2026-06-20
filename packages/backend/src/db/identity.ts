import { getDb } from './database';
import type { IdentityProfile } from '@iki/backend/types/identity';
import { createPrefixedId } from '@iki/backend/utils/id';
import { toIsoNow } from '@iki/backend/utils/text';

const toJsonString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const normalizeActive = (value: unknown): number => {
  if (value === true || value === 1) return 1;
  return 0;
};

const normalizeRow = (row: IdentityProfile | null | undefined): IdentityProfile | null => {
  if (!row) return null;
  return {
    ...row,
    active: row.active ? 1 : 0,
  };
};

const clearActiveIdentityProfiles = () => {
  getDb().prepare('UPDATE identity_profiles SET active = 0 WHERE active != 0').run();
};

export const listIdentityProfiles = (): IdentityProfile[] => {
  const rows = getDb()
    .prepare('SELECT * FROM identity_profiles ORDER BY active DESC, updated_at DESC')
    .all() as IdentityProfile[];
  return rows.map(row => ({
    ...row,
    active: row.active ? 1 : 0,
  }));
};

export const getIdentityProfile = (id: string): IdentityProfile | null => {
  if (!id) return null;
  const row = getDb().prepare('SELECT * FROM identity_profiles WHERE id = ?').get(id) as
    | IdentityProfile
    | undefined;
  return normalizeRow(row);
};

export const getActiveIdentityProfile = (): IdentityProfile | null => {
  const row = getDb()
    .prepare('SELECT * FROM identity_profiles WHERE active = 1 ORDER BY updated_at DESC LIMIT 1')
    .get() as IdentityProfile | undefined;
  return normalizeRow(row);
};

export const addIdentityProfile = (entry: {
  id?: string;
  name: string;
  self_description?: string;
  owner_name?: string;
  owner_role_description?: string;
  core_values?: readonly string[] | string | null;
  boundaries?: readonly string[] | string | null;
  tone_guidance?: string;
  active?: boolean | number;
  metadata?: unknown;
}): IdentityProfile | null => {
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) return null;

  const id = entry.id?.trim() || createPrefixedId('identity');
  const now = toIsoNow();
  const active = normalizeActive(entry.active);

  const insert = getDb().transaction(() => {
    if (active) {
      clearActiveIdentityProfiles();
    }

    getDb()
      .prepare(
        `
        INSERT INTO identity_profiles (
          id, name, self_description, owner_name, owner_role_description,
          core_values, boundaries, tone_guidance, active, metadata, created_at, updated_at
        ) VALUES (
          @id, @name, @self_description, @owner_name, @owner_role_description,
          @core_values, @boundaries, @tone_guidance, @active, @metadata, @created_at, @updated_at
        )
      `
      )
      .run({
        id,
        name,
        self_description:
          typeof entry.self_description === 'string' ? entry.self_description.trim() : '',
        owner_name: typeof entry.owner_name === 'string' ? entry.owner_name.trim() : '',
        owner_role_description:
          typeof entry.owner_role_description === 'string'
            ? entry.owner_role_description.trim()
            : '',
        core_values: toJsonString(entry.core_values),
        boundaries: toJsonString(entry.boundaries),
        tone_guidance: typeof entry.tone_guidance === 'string' ? entry.tone_guidance.trim() : '',
        active,
        metadata: toJsonString(entry.metadata),
        created_at: now,
        updated_at: now,
      });

    return getIdentityProfile(id);
  });

  return insert();
};

export const setActiveIdentityProfile = (id: string): IdentityProfile | null => {
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  const update = getDb().transaction(() => {
    clearActiveIdentityProfiles();
    getDb()
      .prepare(
        `
        UPDATE identity_profiles
        SET active = 1, updated_at = @updated_at
        WHERE id = @id
      `
      )
      .run({
        id: normalizedId,
        updated_at: toIsoNow(),
      });
    return getIdentityProfile(normalizedId);
  });

  return update();
};
