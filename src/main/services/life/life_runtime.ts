import { BrowserWindow } from 'electron';

import * as tasksDb from '../../../core/db/tasks';
import * as lifeDb from '../../../core/db/life';
import * as lifeReflectionDb from '../../../core/db/life_reflection';
import type {
  LifeEpisodeRecord,
  LifeEventType,
  LifeOverview,
  LifePushPayload,
  LifeSnapshot,
  LifeStateEnvelope,
  LifeStateRecord,
} from '../../../shared/types/life';
import {
  LIFE_POLICY_VERSION,
  DEFAULT_SLEEP_WINDOW,
  advanceLifeBudgets,
  chooseLifeActivity,
  getReviewTimestamp,
  normalizeSleepWindow,
  parseLifeStateEnvelope,
  serializeLifeStateEnvelope,
} from './life_activity_engine';
import { getOrCreateActiveIdentityProfile } from '../identity/identity_service';
import { runDueDailyLifeReflections, runDueHourlyLifeReflections } from './life_reflection';

const LIFE_TICK_MS = 60_000;
const DEFAULT_BUDGETS = {
  energy: 0.74,
  focus_budget: 0.7,
  social_availability: 0.78,
};

type LifeRuntimeEvent = {
  type: LifeEventType;
  at?: string;
  taskId?: string | null;
  threadId?: string | null;
  clientId?: string | null;
  triggerRef?: string | null;
  persistAsLastEvent?: boolean;
};

let lifeTimer: NodeJS.Timeout | null = null;
let tickInFlight = false;

const normalizeEventTimestamp = (value?: string): string => {
  if (!value?.trim()) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const pushLifeEventToRenderers = (payload: LifePushPayload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('life:push', payload);
    } catch (error) {
      console.warn('[Life] failed to send push event:', error);
    }
  }
};

const clampUnit = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const next: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }

  return next;
};

const collectTaskSignals = (atIso: string, runningTaskIds: string[]) => {
  const dueTasks = tasksDb.listDueProactiveTasks(atIso);
  const enabledTasks = tasksDb.getProactiveTasks().filter(task => task.enabled);
  const nextDueAt = enabledTasks
    .map(task => task.next_run_at || null)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .sort()[0] || null;

  return {
    runningTaskIds: uniqueStrings(runningTaskIds),
    dueTaskCount: dueTasks.length,
    nextDueAt,
  };
};

const applyRuntimeEventToEnvelope = (
  envelope: LifeStateEnvelope,
  event: LifeRuntimeEvent,
  atIso: string
): LifeStateEnvelope => {
  const next: LifeStateEnvelope = {
    ...envelope,
    runningTaskIds: uniqueStrings(envelope.runningTaskIds || []),
  };

  if (event.type === 'task-started' && event.taskId) {
    next.runningTaskIds = uniqueStrings([...(next.runningTaskIds || []), event.taskId]);
    next.lastTaskStatus = null;
  } else if ((event.type === 'task-finished' || event.type === 'task-failed') && event.taskId) {
    next.runningTaskIds = (next.runningTaskIds || []).filter(id => id !== event.taskId);
    next.lastTaskFinishedAt = atIso;
    next.lastTaskThreadId = event.threadId?.trim() || next.lastTaskThreadId || null;
    next.lastTaskStatus = event.type === 'task-failed' ? 'error' : 'success';
  }

  if (event.persistAsLastEvent !== false) {
    next.lastEventType = event.type;
  }

  return next;
};

const getElapsedMinutes = (fromIso: string | null | undefined, toIso: string): number => {
  if (!fromIso?.trim()) return 0;
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
};

const buildEpisodeSummary = (params: {
  decision: ReturnType<typeof chooseLifeActivity>;
  taskSignals: ReturnType<typeof collectTaskSignals>;
  taskId?: string | null;
  atIso: string;
}): string => {
  const { activity, transitionReason } = params.decision;

  switch (activity) {
    case 'sleep':
      return 'Asleep during the scheduled sleep window.';
    case 'wake_transition':
      return 'Waking up and reorienting for the day.';
    case 'focused_work':
      return params.taskId
        ? `Focused on proactive task ${params.taskId}.`
        : 'Focused on an active commitment.';
    case 'maintenance':
      return params.taskSignals.dueTaskCount > 0
        ? `Monitoring ${params.taskSignals.dueTaskCount} due commitment(s).`
        : 'Monitoring upcoming commitments.';
    case 'recovery':
      return 'Recovering after sustained activity.';
    case 'companion_idle':
    default:
      return transitionReason === 'idle-available'
        ? 'Available and monitoring for user activity.'
        : 'Available between commitments.';
  }
};

const buildEpisodeSnapshotJson = (params: {
  decision: ReturnType<typeof chooseLifeActivity>;
  taskSignals: ReturnType<typeof collectTaskSignals>;
  budgets: Pick<LifeStateRecord, 'energy' | 'focus_budget' | 'social_availability'>;
}): string =>
  JSON.stringify({
    dayPhase: params.decision.dayPhase,
    transitionReason: params.decision.transitionReason,
    runningTaskIds: params.taskSignals.runningTaskIds,
    dueTaskCount: params.taskSignals.dueTaskCount,
    nextDueAt: params.taskSignals.nextDueAt,
    energy: clampUnit(params.budgets.energy, DEFAULT_BUDGETS.energy),
    focusBudget: clampUnit(params.budgets.focus_budget, DEFAULT_BUDGETS.focus_budget),
    socialAvailability: clampUnit(
      params.budgets.social_availability,
      DEFAULT_BUDGETS.social_availability
    ),
  });

const buildSnapshot = (state: LifeStateRecord, currentEpisode: LifeEpisodeRecord | null): LifeSnapshot => {
  const envelope = parseLifeStateEnvelope(state.state_json);
  return {
    state,
    derived: {
      dayPhase: envelope.dayPhase || 'day',
      lastTransitionReason: envelope.lastTransitionReason,
      lastEventType: envelope.lastEventType,
      runningTaskIds: envelope.runningTaskIds || [],
    },
    currentEpisode,
  };
};

const shouldStartNewEpisode = (params: {
  currentEpisode: LifeEpisodeRecord | null;
  nextActivity: LifeStateRecord['current_activity'];
  nextPresence: LifeStateRecord['presence'];
  taskId?: string | null;
  threadId?: string | null;
}): boolean => {
  const { currentEpisode } = params;
  if (!currentEpisode) return true;
  if (currentEpisode.ended_at) return true;
  if (currentEpisode.activity_type !== params.nextActivity) return true;
  if (currentEpisode.presence !== params.nextPresence) return true;
  if ((currentEpisode.task_id || null) !== (params.taskId || null)) return true;
  if ((currentEpisode.thread_id || null) !== (params.threadId || null)) return true;
  return false;
};

const reconcileLifeState = (event: LifeRuntimeEvent): LifeSnapshot | null => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return null;

  const atIso = normalizeEventTimestamp(event.at);
  const now = new Date(atIso);
  let semanticChange = false;

  const snapshot = lifeDb.runLifeTransaction(() => {
    const existingState = lifeDb.getLifeState(profile.id);
    const sleepWindow = normalizeSleepWindow(
      existingState?.sleep_window_json ? JSON.parse(existingState.sleep_window_json) : DEFAULT_SLEEP_WINDOW
    );
    const previousEnvelope = parseLifeStateEnvelope(existingState?.state_json);
    const nextEnvelopeBase = applyRuntimeEventToEnvelope(previousEnvelope, event, atIso);
    const taskSignals = collectTaskSignals(atIso, nextEnvelopeBase.runningTaskIds || []);
    const decision = chooseLifeActivity({
      now,
      sleepWindow,
      tasks: taskSignals,
    });
    const nextEnvelope: LifeStateEnvelope = {
      ...nextEnvelopeBase,
      dayPhase: decision.dayPhase,
      lastTransitionReason: decision.transitionReason,
    };

    if (!existingState) {
      const episode = lifeDb.addLifeEpisode({
        profile_id: profile.id,
        activity_type: decision.activity,
        presence: decision.presence,
        started_at: atIso,
        transition_reason: decision.transitionReason,
        summary: buildEpisodeSummary({
          decision,
          taskSignals,
          taskId: event.taskId,
          atIso,
        }),
        trigger_type: event.type,
        trigger_ref: event.triggerRef || event.taskId || decision.transitionReason,
        thread_id: event.threadId ?? null,
        client_id: event.clientId ?? null,
        task_id: event.taskId ?? null,
        snapshot_json: buildEpisodeSnapshotJson({
          decision,
          taskSignals,
          budgets: DEFAULT_BUDGETS,
        }),
      });

      const state = lifeDb.upsertLifeState({
        profile_id: profile.id,
        current_activity: decision.activity,
        presence: decision.presence,
        energy: DEFAULT_BUDGETS.energy,
        focus_budget: DEFAULT_BUDGETS.focus_budget,
        social_availability: DEFAULT_BUDGETS.social_availability,
        current_episode_id: episode.id,
        next_review_at: getReviewTimestamp(now, decision.reviewMinutes),
        sleep_window_json: JSON.stringify(sleepWindow),
        policy_version: LIFE_POLICY_VERSION,
        state_json: serializeLifeStateEnvelope(nextEnvelope),
      });

      semanticChange = true;
      return buildSnapshot(state, episode);
    }

    const elapsedMinutes = getElapsedMinutes(existingState.updated_at, atIso);
    const driftedBudgets = advanceLifeBudgets(
      existingState.current_activity,
      {
        energy: existingState.energy,
        focus_budget: existingState.focus_budget,
        social_availability: existingState.social_availability,
      },
      elapsedMinutes
    );

    const currentEpisode = existingState.current_episode_id
      ? lifeDb.getLifeEpisode(existingState.current_episode_id)
      : null;

    let nextEpisode = currentEpisode;
    if (
      shouldStartNewEpisode({
        currentEpisode,
        nextActivity: decision.activity,
        nextPresence: decision.presence,
        taskId: event.taskId ?? null,
        threadId: event.threadId ?? null,
      })
    ) {
      if (currentEpisode && !currentEpisode.ended_at) {
        lifeDb.updateLifeEpisode(currentEpisode.id, {
          ended_at: atIso,
        });
      }

      nextEpisode = lifeDb.addLifeEpisode({
        profile_id: profile.id,
        activity_type: decision.activity,
        presence: decision.presence,
        started_at: atIso,
        transition_reason: decision.transitionReason,
        summary: buildEpisodeSummary({
          decision,
          taskSignals,
          taskId: event.taskId,
          atIso,
        }),
        trigger_type: event.type,
        trigger_ref: event.triggerRef || event.taskId || decision.transitionReason,
        thread_id: event.threadId ?? null,
        client_id: event.clientId ?? null,
        task_id: event.taskId ?? null,
        snapshot_json: buildEpisodeSnapshotJson({
          decision,
          taskSignals,
          budgets: driftedBudgets,
        }),
      });
      semanticChange = true;
    }

    const nextState = lifeDb.upsertLifeState({
      id: existingState.id,
      profile_id: profile.id,
      current_activity: decision.activity,
      presence: decision.presence,
      energy: driftedBudgets.energy,
      focus_budget: driftedBudgets.focus_budget,
      social_availability: driftedBudgets.social_availability,
      current_episode_id: nextEpisode?.id ?? null,
      next_review_at: getReviewTimestamp(now, decision.reviewMinutes),
      sleep_window_json: JSON.stringify(sleepWindow),
      policy_version: LIFE_POLICY_VERSION,
      state_json: serializeLifeStateEnvelope(nextEnvelope),
      created_at: existingState.created_at,
    });

    if (
      nextState.current_activity !== existingState.current_activity ||
      nextState.presence !== existingState.presence ||
      nextState.current_episode_id !== existingState.current_episode_id
    ) {
      semanticChange = true;
    }

    return buildSnapshot(nextState, nextEpisode);
  });

  if (snapshot && (semanticChange || (event.type !== 'tick' && event.persistAsLastEvent !== false))) {
    pushLifeEventToRenderers({
      type: 'life-state',
      snapshot,
      sourceEvent: event.type,
    });
  }

  return snapshot;
};

const tick = async () => {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const snapshot = reconcileLifeState({ type: 'tick' });
    if (snapshot) {
      await runDueHourlyLifeReflections({ now: snapshot.state.updated_at });
      await runDueDailyLifeReflections({ now: snapshot.state.updated_at });
    }
  } catch (error) {
    console.warn('[Life] tick failed:', error);
  } finally {
    tickInFlight = false;
  }
};

export const startLifeRuntime = () => {
  if (lifeTimer) return;
  lifeTimer = setInterval(() => {
    void tick();
  }, LIFE_TICK_MS);
  const snapshot = reconcileLifeState({ type: 'runtime-start' });
  if (snapshot) {
    void (async () => {
      await runDueHourlyLifeReflections({ now: snapshot.state.updated_at });
      await runDueDailyLifeReflections({ now: snapshot.state.updated_at });
    })();
  }
};

export const stopLifeRuntime = () => {
  if (!lifeTimer) return;
  clearInterval(lifeTimer);
  lifeTimer = null;
};

export const recordLifeRuntimeEvent = (event: LifeRuntimeEvent): LifeSnapshot | null =>
  reconcileLifeState(event);

export const getLifeOverview = (limit = 10): LifeOverview => {
  const snapshot = reconcileLifeState({
    type: 'manual-refresh',
    persistAsLastEvent: false,
  });
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) {
    return { snapshot: null, recentEpisodes: [], recentReflections: [] };
  }

  return {
    snapshot,
    recentEpisodes: lifeDb.listLifeEpisodes(profile.id, limit),
    recentReflections: lifeReflectionDb.listLifeReflections({
      profileId: profile.id,
      limit: Math.max(1, Math.min(6, limit)),
    }),
  };
};

export const refreshLifeRuntime = async (): Promise<LifeSnapshot | null> => {
  const snapshot = reconcileLifeState({
    type: 'manual-refresh',
  });
  if (snapshot) {
    await runDueHourlyLifeReflections({ now: snapshot.state.updated_at });
    await runDueDailyLifeReflections({ now: snapshot.state.updated_at });
  }
  return snapshot;
};

const formatPercent = (value: number): string => `${Math.round(clampUnit(value, 0) * 100)}%`;

export const getLifeContextMessage = (): string => {
  const overview = getLifeOverview(4);
  const snapshot = overview.snapshot;
  if (!snapshot) return '';

  const lines = [
    'Current life state for iKi:',
    `- Presence: ${snapshot.state.presence}`,
    `- Activity: ${snapshot.state.current_activity}`,
    `- Day phase: ${snapshot.derived.dayPhase}`,
    `- Energy: ${formatPercent(snapshot.state.energy)}`,
    `- Focus budget: ${formatPercent(snapshot.state.focus_budget)}`,
    `- Social availability: ${formatPercent(snapshot.state.social_availability)}`,
    snapshot.currentEpisode?.summary ? `- Current trajectory: ${snapshot.currentEpisode.summary}` : '',
    snapshot.derived.lastTransitionReason
      ? `- Transition reason: ${snapshot.derived.lastTransitionReason}`
      : '',
    snapshot.derived.runningTaskIds.length > 0
      ? `- Running commitments: ${snapshot.derived.runningTaskIds.join(', ')}`
      : '',
  ];

  return lines.filter(Boolean).join('\n');
};
