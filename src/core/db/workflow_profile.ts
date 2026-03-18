import { getDb } from './database';
import type { WorkflowProfile } from '../../shared/types/workflow';

type WorkflowProfileRow = {
  thread_id: string;
  profile: string;
  created_at: string;
  updated_at: string;
};

const nowIso = (): string => new Date().toISOString();

const parseProfile = (raw: string): WorkflowProfile | null => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as WorkflowProfile;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

export const getWorkflowProfile = (threadId: string): WorkflowProfile | null => {
  const row = getDb()
    .prepare('SELECT * FROM workflow_profiles WHERE thread_id = ?')
    .get(threadId) as WorkflowProfileRow | undefined;
  if (!row) return null;
  return parseProfile(row.profile);
};

export const upsertWorkflowProfile = (threadId: string, profile: WorkflowProfile): void => {
  const now = nowIso();
  const stmt = getDb().prepare(`
    INSERT INTO workflow_profiles (thread_id, profile, created_at, updated_at)
    VALUES (@thread_id, @profile, @created_at, @updated_at)
    ON CONFLICT(thread_id) DO UPDATE SET
      profile = excluded.profile,
      updated_at = excluded.updated_at
  `);
  stmt.run({
    thread_id: threadId,
    profile: JSON.stringify(profile),
    created_at: now,
    updated_at: now,
  });
};

export const deleteWorkflowProfile = (threadId: string): void => {
  getDb().prepare('DELETE FROM workflow_profiles WHERE thread_id = ?').run(threadId);
};

export const clearWorkflowProfiles = (): void => {
  getDb().prepare('DELETE FROM workflow_profiles').run();
};
