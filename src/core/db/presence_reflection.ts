import { getDb } from './database';
import type {
  PresenceReflectionPeriodType,
  PresenceReflectionRecord,
} from '../../shared/types/presence';
import { createPrefixedId } from '../../shared/utils/id';
import { toIsoNow } from '../../shared/utils/text';

export const getPresenceReflection = (
  profileId: string,
  periodType: PresenceReflectionPeriodType,
  periodStart: string
): PresenceReflectionRecord | null => {
  if (!profileId?.trim() || !periodStart?.trim()) return null;
  const row = getDb()
    .prepare(
      `
      SELECT * FROM life_reflections
      WHERE profile_id = ? AND period_type = ? AND period_start = ?
      LIMIT 1
    `
    )
    .get(profileId, periodType, periodStart) as PresenceReflectionRecord | undefined;
  return row || null;
};

export const getLatestPresenceReflection = (
  profileId: string,
  periodType?: PresenceReflectionPeriodType
): PresenceReflectionRecord | null => {
  if (!profileId?.trim()) return null;
  const row = periodType
    ? ((getDb()
        .prepare(
          `
          SELECT * FROM life_reflections
          WHERE profile_id = ? AND period_type = ?
          ORDER BY period_end DESC, created_at DESC
          LIMIT 1
        `
        )
        .get(profileId, periodType) as PresenceReflectionRecord | undefined) ?? null)
    : ((getDb()
        .prepare(
          `
          SELECT * FROM life_reflections
          WHERE profile_id = ?
          ORDER BY period_end DESC, created_at DESC
          LIMIT 1
        `
        )
        .get(profileId) as PresenceReflectionRecord | undefined) ?? null);
  return row || null;
};

export const listPresenceReflections = (params: {
  profileId: string;
  periodType?: PresenceReflectionPeriodType;
  limit?: number;
}): PresenceReflectionRecord[] => {
  const profileId = params.profileId?.trim();
  if (!profileId) return [];

  const limit = Number.isFinite(params.limit) ? Math.max(1, Math.trunc(params.limit || 0)) : 10;
  const rows = params.periodType
    ? ((getDb()
        .prepare(
          `
          SELECT * FROM life_reflections
          WHERE profile_id = ? AND period_type = ?
          ORDER BY period_end DESC, created_at DESC
          LIMIT ?
        `
        )
        .all(profileId, params.periodType, limit) as PresenceReflectionRecord[]) ?? [])
    : ((getDb()
        .prepare(
          `
          SELECT * FROM life_reflections
          WHERE profile_id = ?
          ORDER BY period_end DESC, created_at DESC
          LIMIT ?
        `
        )
        .all(profileId, limit) as PresenceReflectionRecord[]) ?? []);

  return rows;
};

export const listPresenceReflectionsInWindow = (params: {
  profileId: string;
  periodType: PresenceReflectionPeriodType;
  periodStart: string;
  periodEnd: string;
}): PresenceReflectionRecord[] => {
  const profileId = params.profileId?.trim();
  const periodStart = params.periodStart?.trim();
  const periodEnd = params.periodEnd?.trim();
  if (!profileId || !periodStart || !periodEnd) return [];

  const rows = getDb()
    .prepare(
      `
      SELECT * FROM life_reflections
      WHERE profile_id = ?
        AND period_type = ?
        AND period_start >= ?
        AND period_end <= ?
      ORDER BY period_start ASC, created_at ASC
    `
    )
    .all(profileId, params.periodType, periodStart, periodEnd) as PresenceReflectionRecord[];

  return rows;
};

export const addPresenceReflection = (entry: {
  id?: string;
  profile_id: string;
  period_type: PresenceReflectionPeriodType;
  period_start: string;
  period_end: string;
  summary: string;
  insights_json?: string | null;
  plan_json?: string | null;
}): PresenceReflectionRecord => {
  const id = entry.id?.trim() || createPrefixedId('reflection');
  const createdAt = toIsoNow();

  getDb()
    .prepare(
      `
      INSERT INTO life_reflections (
        id,
        profile_id,
        period_type,
        period_start,
        period_end,
        summary,
        insights_json,
        plan_json,
        created_at
      ) VALUES (
        @id,
        @profile_id,
        @period_type,
        @period_start,
        @period_end,
        @summary,
        @insights_json,
        @plan_json,
        @created_at
      )
    `
    )
    .run({
      id,
      profile_id: entry.profile_id,
      period_type: entry.period_type,
      period_start: entry.period_start,
      period_end: entry.period_end,
      summary: entry.summary,
      insights_json: entry.insights_json ?? null,
      plan_json: entry.plan_json ?? null,
      created_at: createdAt,
    });

  const reloaded = getPresenceReflection(entry.profile_id, entry.period_type, entry.period_start);
  if (!reloaded) {
    throw new Error('Failed to reload presence reflection after insert');
  }
  return reloaded;
};
