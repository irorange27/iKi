import { getDb } from './database';
import type {
  LifeActivity,
  LifeEpisodeRecord,
  LifePresence,
  LifeStateRecord,
} from '../../shared/types/life';

const nowIso = () => new Date().toISOString();

const createRuntimeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const clampUnit = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

const normalizeLifeStateRow = (row: LifeStateRecord | null | undefined): LifeStateRecord | null => {
  if (!row) return null;
  return {
    ...row,
    energy: clampUnit(row.energy, 0.7),
    focus_budget: clampUnit(row.focus_budget, 0.7),
    social_availability: clampUnit(row.social_availability, 0.7),
  };
};

const normalizeLifeEpisodeRow = (
  row: LifeEpisodeRecord | null | undefined
): LifeEpisodeRecord | null => {
  if (!row) return null;
  return { ...row };
};

export const runLifeTransaction = <T>(fn: () => T): T => getDb().transaction(fn)();

export const getLifeState = (profileId: string): LifeStateRecord | null => {
  if (!profileId?.trim()) return null;
  const row = getDb().prepare('SELECT * FROM life_state WHERE profile_id = ?').get(profileId) as
    | LifeStateRecord
    | undefined;
  return normalizeLifeStateRow(row);
};

export const upsertLifeState = (
  entry: Partial<LifeStateRecord> & {
    profile_id: string;
    current_activity: LifeActivity;
    presence: LifePresence;
    energy: number;
    focus_budget: number;
    social_availability: number;
    policy_version: string;
  }
): LifeStateRecord => {
  const profileId = entry.profile_id.trim();
  const existing = getLifeState(profileId);
  const timestamp = nowIso();
  const id = existing?.id || entry.id?.trim() || createRuntimeId('life');
  const createdAt = existing?.created_at || entry.created_at || timestamp;

  getDb()
    .prepare(
      `
      INSERT INTO life_state (
        id,
        profile_id,
        current_activity,
        presence,
        energy,
        focus_budget,
        social_availability,
        current_episode_id,
        next_review_at,
        sleep_window_json,
        policy_version,
        state_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @profile_id,
        @current_activity,
        @presence,
        @energy,
        @focus_budget,
        @social_availability,
        @current_episode_id,
        @next_review_at,
        @sleep_window_json,
        @policy_version,
        @state_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(profile_id) DO UPDATE SET
        current_activity = excluded.current_activity,
        presence = excluded.presence,
        energy = excluded.energy,
        focus_budget = excluded.focus_budget,
        social_availability = excluded.social_availability,
        current_episode_id = excluded.current_episode_id,
        next_review_at = excluded.next_review_at,
        sleep_window_json = excluded.sleep_window_json,
        policy_version = excluded.policy_version,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `
    )
    .run({
      id,
      profile_id: profileId,
      current_activity: entry.current_activity,
      presence: entry.presence,
      energy: clampUnit(entry.energy, 0.7),
      focus_budget: clampUnit(entry.focus_budget, 0.7),
      social_availability: clampUnit(entry.social_availability, 0.7),
      current_episode_id: entry.current_episode_id ?? null,
      next_review_at: entry.next_review_at ?? null,
      sleep_window_json: entry.sleep_window_json ?? null,
      policy_version: entry.policy_version,
      state_json: entry.state_json ?? null,
      created_at: createdAt,
      updated_at: timestamp,
    });

  const reloaded = getLifeState(profileId);
  if (!reloaded) {
    throw new Error('Failed to reload life state after write');
  }
  return reloaded;
};

export const getLifeEpisode = (id: string): LifeEpisodeRecord | null => {
  if (!id?.trim()) return null;
  const row = getDb().prepare('SELECT * FROM life_episodes WHERE id = ?').get(id) as
    | LifeEpisodeRecord
    | undefined;
  return normalizeLifeEpisodeRow(row);
};

export const listLifeEpisodes = (profileId: string, limit = 20): LifeEpisodeRecord[] => {
  if (!profileId?.trim()) return [];
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 20;
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM life_episodes
      WHERE profile_id = ?
      ORDER BY started_at DESC, created_at DESC
      LIMIT ?
    `
    )
    .all(profileId, normalizedLimit) as LifeEpisodeRecord[];
  return rows.map(row => normalizeLifeEpisodeRow(row)).filter(Boolean) as LifeEpisodeRecord[];
};

export const listLifeEpisodesInWindow = (
  profileId: string,
  windowStart: string,
  windowEnd: string
): LifeEpisodeRecord[] => {
  if (!profileId?.trim() || !windowStart?.trim() || !windowEnd?.trim()) return [];
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM life_episodes
      WHERE profile_id = ?
        AND started_at < ?
        AND (ended_at IS NULL OR ended_at >= ?)
      ORDER BY started_at ASC, created_at ASC
    `
    )
    .all(profileId, windowEnd, windowStart) as LifeEpisodeRecord[];
  return rows.map(row => normalizeLifeEpisodeRow(row)).filter(Boolean) as LifeEpisodeRecord[];
};

export const addLifeEpisode = (
  entry: Partial<LifeEpisodeRecord> & {
    profile_id: string;
    activity_type: LifeActivity;
    presence: LifePresence;
    started_at?: string;
    transition_reason: string;
  }
): LifeEpisodeRecord => {
  const timestamp = nowIso();
  const id = entry.id?.trim() || createRuntimeId('episode');

  getDb()
    .prepare(
      `
      INSERT INTO life_episodes (
        id,
        profile_id,
        activity_type,
        presence,
        started_at,
        ended_at,
        transition_reason,
        summary,
        trigger_type,
        trigger_ref,
        thread_id,
        client_id,
        task_id,
        snapshot_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @profile_id,
        @activity_type,
        @presence,
        @started_at,
        @ended_at,
        @transition_reason,
        @summary,
        @trigger_type,
        @trigger_ref,
        @thread_id,
        @client_id,
        @task_id,
        @snapshot_json,
        @created_at,
        @updated_at
      )
    `
    )
    .run({
      id,
      profile_id: entry.profile_id.trim(),
      activity_type: entry.activity_type,
      presence: entry.presence,
      started_at: entry.started_at || timestamp,
      ended_at: entry.ended_at ?? null,
      transition_reason: entry.transition_reason,
      summary: entry.summary ?? null,
      trigger_type: entry.trigger_type ?? null,
      trigger_ref: entry.trigger_ref ?? null,
      thread_id: entry.thread_id ?? null,
      client_id: entry.client_id ?? null,
      task_id: entry.task_id ?? null,
      snapshot_json: entry.snapshot_json ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    });

  const reloaded = getLifeEpisode(id);
  if (!reloaded) {
    throw new Error('Failed to reload life episode after insert');
  }
  return reloaded;
};

export const updateLifeEpisode = (id: string, updates: Partial<LifeEpisodeRecord>) => {
  const fields = Object.keys(updates)
    .filter(key => key !== 'id' && key !== 'profile_id' && key !== 'created_at')
    .map(key => `${key} = @${key}`)
    .join(', ');

  if (!fields) return null;

  return getDb()
    .prepare(
      `
      UPDATE life_episodes
      SET ${fields}, updated_at = @updated_at
      WHERE id = @id
    `
    )
    .run({
      ...updates,
      id,
      updated_at: nowIso(),
    });
};
