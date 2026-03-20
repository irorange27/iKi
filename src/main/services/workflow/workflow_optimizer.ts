import { getAppConfig } from '../../../core/config';
import {
  getWorkflowProfile,
  upsertWorkflowProfile,
  clearWorkflowProfiles,
} from '../../../core/db/workflow_profile';
import { normalizeSkillIds } from '../../../core/skills';
import type { WorkflowOptimizationConfig, WorkflowProfile } from '../../../shared/types/workflow';

const DEFAULT_PROFILE: WorkflowProfile = {
  version: 1,
  stats: {
    autoSkillRuns: 0,
  },
  skills: {},
  pinnedSkills: [],
};

const cloneDefaultProfile = (): WorkflowProfile =>
  JSON.parse(JSON.stringify(DEFAULT_PROFILE)) as WorkflowProfile;

const normalizeProfile = (profile: WorkflowProfile | null): WorkflowProfile => {
  if (!profile) return cloneDefaultProfile();

  const stats = profile.stats && typeof profile.stats === 'object' ? profile.stats : {};
  const skills = profile.skills && typeof profile.skills === 'object' ? profile.skills : {};
  const pinnedSkills = Array.isArray(profile.pinnedSkills) ? profile.pinnedSkills : [];

  const normalizedSkills: WorkflowProfile['skills'] = {};
  for (const [id, entry] of Object.entries(skills)) {
    if (!entry || typeof entry !== 'object') continue;
    const rawSelections = (entry as { selections?: unknown }).selections;
    const rawLastSelectedAt = (entry as { lastSelectedAt?: unknown }).lastSelectedAt;
    const selections =
      typeof rawSelections === 'number' && Number.isFinite(rawSelections)
        ? Math.max(0, Math.trunc(rawSelections))
        : 0;
    const lastSelectedAt =
      typeof rawLastSelectedAt === 'string' && rawLastSelectedAt.trim().length > 0
        ? rawLastSelectedAt
        : undefined;
    normalizedSkills[id] = lastSelectedAt ? { selections, lastSelectedAt } : { selections };
  }

  const normalizedPinnedSkills = pinnedSkills
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map(id => id.trim());

  return {
    version: 1,
    stats: {
      autoSkillRuns:
        typeof (stats as { autoSkillRuns?: unknown }).autoSkillRuns === 'number'
          ? Math.max(0, Math.trunc((stats as { autoSkillRuns: number }).autoSkillRuns))
          : 0,
    },
    skills: normalizedSkills,
    pinnedSkills: normalizedPinnedSkills,
  };
};

const getWorkflowOptimizationConfig = (): WorkflowOptimizationConfig =>
  getAppConfig().workflowOptimization;

const shouldTrackSkills = (config: WorkflowOptimizationConfig): boolean =>
  config.enabled && config.autoPinSkills;

const computeConfidence = (selections: number, totalRuns: number): number => {
  const alpha = selections + 1;
  const beta = Math.max(0, totalRuns - selections) + 1;
  return alpha / (alpha + beta);
};

type SkillScore = {
  id: string;
  score: number;
  selections: number;
  lastSelectedAt?: string;
};

const compareSkillScore = (a: SkillScore, b: SkillScore): number => {
  if (b.score !== a.score) return b.score - a.score;
  if (b.selections !== a.selections) return b.selections - a.selections;
  const aTime = a.lastSelectedAt ? new Date(a.lastSelectedAt).getTime() : 0;
  const bTime = b.lastSelectedAt ? new Date(b.lastSelectedAt).getTime() : 0;
  if (bTime !== aTime) return bTime - aTime;
  return a.id.localeCompare(b.id);
};

export const computePinnedSkills = (params: {
  profile: WorkflowProfile;
  config: WorkflowOptimizationConfig;
  availableSkillIds: Set<string>;
}): string[] => {
  const { profile, config, availableSkillIds } = params;
  const totalRuns = Math.max(0, Math.trunc(profile.stats.autoSkillRuns));
  const currentPinned = new Set(
    (profile.pinnedSkills || []).filter(id => availableSkillIds.has(id))
  );

  const scores: SkillScore[] = [];
  const seenIds = new Set<string>();

  for (const [id, entry] of Object.entries(profile.skills || {})) {
    if (!availableSkillIds.has(id)) continue;
    const selections =
      typeof entry.selections === 'number' && Number.isFinite(entry.selections)
        ? Math.max(0, Math.trunc(entry.selections))
        : 0;
    const score = computeConfidence(selections, totalRuns);
    scores.push({
      id,
      score,
      selections,
      lastSelectedAt: entry.lastSelectedAt,
    });
    seenIds.add(id);

    if (totalRuns >= config.minAutoSkillRuns) {
      if (selections >= config.minSkillSelections && score >= config.pinConfidence) {
        currentPinned.add(id);
      }
      if (currentPinned.has(id) && score < config.unpinConfidence) {
        currentPinned.delete(id);
      }
    }
  }

  for (const id of currentPinned) {
    if (seenIds.has(id)) continue;
    scores.push({
      id,
      score: computeConfidence(0, totalRuns),
      selections: 0,
    });
  }

  const maxPinned = Math.max(0, Math.trunc(config.maxPinnedSkills));
  if (maxPinned === 0 || currentPinned.size === 0) return [];

  const ranked = scores.filter(entry => currentPinned.has(entry.id)).sort(compareSkillScore);
  return ranked.slice(0, maxPinned).map(entry => entry.id);
};

export const getAutoPinnedSkillIds = (threadId: string): string[] => {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return [];

  const config = getWorkflowOptimizationConfig();
  if (!shouldTrackSkills(config)) return [];

  const profile = normalizeProfile(getWorkflowProfile(normalizedThreadId));
  return profile.pinnedSkills;
};

export const recordAutoSkillSelection = (params: {
  threadId: string;
  availableSkillIds: string[];
  selectedSkillIds: string[];
  timestamp?: string;
}): void => {
  const normalizedThreadId = params.threadId.trim();
  if (!normalizedThreadId) return;

  const config = getWorkflowOptimizationConfig();
  if (!shouldTrackSkills(config)) return;

  const availableSet = new Set(
    params.availableSkillIds
      .filter((id): id is string => typeof id === 'string')
      .map(id => id.trim())
      .filter(Boolean)
  );
  if (availableSet.size === 0) return;

  const selectedSkillIds = normalizeSkillIds(params.selectedSkillIds).filter(id =>
    availableSet.has(id)
  );

  const profile = normalizeProfile(getWorkflowProfile(normalizedThreadId));
  profile.stats.autoSkillRuns += 1;

  const now = params.timestamp || new Date().toISOString();
  for (const id of selectedSkillIds) {
    const entry = profile.skills[id] ?? { selections: 0 };
    entry.selections = Math.max(0, Math.trunc(entry.selections)) + 1;
    entry.lastSelectedAt = now;
    profile.skills[id] = entry;
  }

  const nextSkills: WorkflowProfile['skills'] = {};
  for (const [id, entry] of Object.entries(profile.skills)) {
    if (availableSet.has(id) || profile.pinnedSkills.includes(id)) {
      nextSkills[id] = entry;
    }
  }
  profile.skills = nextSkills;
  for (const id of profile.pinnedSkills) {
    if (!profile.skills[id]) {
      profile.skills[id] = { selections: 0 };
    }
  }

  const nextPinned = computePinnedSkills({
    profile,
    config,
    availableSkillIds: availableSet,
  });
  profile.pinnedSkills = nextPinned;

  upsertWorkflowProfile(normalizedThreadId, profile);
};

export const resetWorkflowOptimizationState = (): void => {
  clearWorkflowProfiles();
};
