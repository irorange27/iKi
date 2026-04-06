import * as tasksDb from '../../../core/db/tasks';
import * as presenceDb from '../../../core/db/presence';
import * as presenceReflectionDb from '../../../core/db/presence_reflection';
import { createLogger } from '../../../core/logger';
import type {
  PresenceEpisodeRecord,
  PresenceEventType,
  PresenceOwnerMode,
  PresenceOwnerModeStatus,
  PresenceOverview,
  PresenceSnapshot,
  PresenceStateEnvelope,
  PresenceStateRecord,
  PresencePushPayload,
} from '../../../shared/types/presence';
import {
  PRESENCE_POLICY_VERSION,
  DEFAULT_SLEEP_WINDOW,
  advancePresenceBudgets,
  choosePresenceActivity,
  getReviewTimestamp,
  normalizeSleepWindow,
  parsePresenceStateEnvelope,
  serializePresenceStateEnvelope,
} from './presence_activity_engine';
import { getOrCreateActiveIdentityProfile } from '../identity/identity_service';
import { runDueDailyRuntimeReflections, runDueHourlyRuntimeReflections } from './presence_reflection';
import { getAllBrowserWindows } from '../../utils/browser_windows';

const PRESENCE_TICK_MS = 60_000;
const DEFAULT_BUDGETS = {
  energy: 0.74,
  focus_budget: 0.7,
  social_availability: 0.78,
};
const presenceRuntimeLogger = createLogger({ module: 'presence_runtime' });

type PresenceRuntimeEvent = {
  type: PresenceEventType;
  at?: string;
  taskId?: string | null;
  threadId?: string | null;
  clientId?: string | null;
  triggerRef?: string | null;
  ownerMode?: PresenceOwnerMode | null;
  ownerModeNote?: string | null;
  persistAsLastEvent?: boolean;
};

let presenceTimer: NodeJS.Timeout | null = null;
let tickInFlight = false;

const normalizeEventTimestamp = (value?: string): string => {
  if (!value?.trim()) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const pushPresenceEventToRenderers = (payload: PresencePushPayload) => {
  for (const win of getAllBrowserWindows()) {
    try {
      win.webContents.send('presence:push', payload);
    } catch (error) {
      presenceRuntimeLogger.event({
        level: 'warn',
        event: 'presence.push',
        outcome: 'degraded',
        error,
        message: 'Failed to push presence event to renderer.',
      });
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

const getExpectedActivityForOwnerMode = (
  ownerMode: PresenceOwnerMode | null | undefined
): PresenceStateRecord['current_activity'] | null => {
  if (ownerMode === 'sleep') return 'sleep';
  if (ownerMode === 'focus') return 'focused_work';
  if (ownerMode === 'available') return 'companion_idle';
  return null;
};

const getOwnerModeStatus = (params: {
  ownerMode: PresenceOwnerMode | null | undefined;
  currentActivity: PresenceStateRecord['current_activity'];
}): PresenceOwnerModeStatus => {
  const expectedActivity = getExpectedActivityForOwnerMode(params.ownerMode);
  if (!expectedActivity) return 'none';
  return params.currentActivity === expectedActivity ? 'applied' : 'deferred';
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
  envelope: PresenceStateEnvelope,
  event: PresenceRuntimeEvent,
  atIso: string
): PresenceStateEnvelope => {
  const next: PresenceStateEnvelope = {
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

  if (event.type === 'owner-mode-set') {
    next.ownerMode = event.ownerMode || null;
    next.ownerModeSetAt = atIso;
    next.ownerModeNote = event.ownerModeNote?.trim() || null;
  } else if (event.type === 'owner-mode-cleared') {
    next.ownerMode = null;
    next.ownerModeSetAt = null;
    next.ownerModeNote = null;
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
  decision: ReturnType<typeof choosePresenceActivity>;
  taskSignals: ReturnType<typeof collectTaskSignals>;
  taskId?: string | null;
}): string => {
  const { activity, transitionReason } = params.decision;

  switch (activity) {
    case 'sleep':
      if (transitionReason === 'owner-mode-sleep') {
        return 'Sleeping because the owner explicitly set sleep mode.';
      }
      return 'Asleep during the scheduled sleep window.';
    case 'wake_transition':
      return 'Waking up and reorienting for the day.';
    case 'focused_work':
      if (transitionReason === 'owner-mode-focus') {
        return 'Holding a focused mode because the owner explicitly requested focus.';
      }
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
      if (transitionReason === 'owner-mode-available') {
        return 'Staying available because the owner explicitly requested availability.';
      }
      return transitionReason === 'idle-available'
        ? 'Available and monitoring for user activity.'
        : 'Available between commitments.';
  }
};

const buildEpisodeSnapshotJson = (params: {
  decision: ReturnType<typeof choosePresenceActivity>;
  taskSignals: ReturnType<typeof collectTaskSignals>;
  budgets: Pick<PresenceStateRecord, 'energy' | 'focus_budget' | 'social_availability'>;
  ownerMode?: PresenceOwnerMode | null;
}): string =>
  JSON.stringify({
    dayPhase: params.decision.dayPhase,
    transitionReason: params.decision.transitionReason,
    runningTaskIds: params.taskSignals.runningTaskIds,
    dueTaskCount: params.taskSignals.dueTaskCount,
    nextDueAt: params.taskSignals.nextDueAt,
    ownerMode: params.ownerMode || null,
    energy: clampUnit(params.budgets.energy, DEFAULT_BUDGETS.energy),
    focusBudget: clampUnit(params.budgets.focus_budget, DEFAULT_BUDGETS.focus_budget),
    socialAvailability: clampUnit(
      params.budgets.social_availability,
      DEFAULT_BUDGETS.social_availability
    ),
  });

const buildSnapshot = (state: PresenceStateRecord, currentEpisode: PresenceEpisodeRecord | null): PresenceSnapshot => {
  const envelope = parsePresenceStateEnvelope(state.state_json);
  const ownerModeStatus = getOwnerModeStatus({
    ownerMode: envelope.ownerMode,
    currentActivity: state.current_activity,
  });
  return {
    state,
    derived: {
      dayPhase: envelope.dayPhase || 'day',
      lastTransitionReason: envelope.lastTransitionReason,
      lastEventType: envelope.lastEventType,
      runningTaskIds: envelope.runningTaskIds || [],
      ownerMode: envelope.ownerMode || null,
      ownerModeSetAt: envelope.ownerModeSetAt || null,
      ownerModeNote: envelope.ownerModeNote || null,
      ownerModeStatus,
    },
    currentEpisode,
  };
};

const shouldStartNewEpisode = (params: {
  currentEpisode: PresenceEpisodeRecord | null;
  nextActivity: PresenceStateRecord['current_activity'];
  nextPresence: PresenceStateRecord['presence'];
  nextTransitionReason: string;
  taskId?: string | null;
  threadId?: string | null;
}): boolean => {
  const { currentEpisode } = params;
  if (!currentEpisode) return true;
  if (currentEpisode.ended_at) return true;
  if (currentEpisode.activity_type !== params.nextActivity) return true;
  if (currentEpisode.presence !== params.nextPresence) return true;
  if (currentEpisode.transition_reason !== params.nextTransitionReason) return true;
  if ((currentEpisode.task_id || null) !== (params.taskId || null)) return true;
  if ((currentEpisode.thread_id || null) !== (params.threadId || null)) return true;
  return false;
};

const reconcilePresenceState = (event: PresenceRuntimeEvent): PresenceSnapshot | null => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return null;

  const atIso = normalizeEventTimestamp(event.at);
  const now = new Date(atIso);
  let semanticChange = false;

  const snapshot = presenceDb.runPresenceTransaction(() => {
    const existingState = presenceDb.getPresenceState(profile.id);
    const sleepWindow = normalizeSleepWindow(
      existingState?.sleep_window_json ? JSON.parse(existingState.sleep_window_json) : DEFAULT_SLEEP_WINDOW
    );
    const previousEnvelope = parsePresenceStateEnvelope(existingState?.state_json);
    const nextEnvelopeBase = applyRuntimeEventToEnvelope(previousEnvelope, event, atIso);
    const taskSignals = collectTaskSignals(atIso, nextEnvelopeBase.runningTaskIds || []);
    const decision = choosePresenceActivity({
      now,
      sleepWindow,
      tasks: taskSignals,
      ownerMode: nextEnvelopeBase.ownerMode || null,
    });
    const nextEnvelope: PresenceStateEnvelope = {
      ...nextEnvelopeBase,
      dayPhase: decision.dayPhase,
      lastTransitionReason: decision.transitionReason,
    };

    if (!existingState) {
      const episode = presenceDb.addPresenceEpisode({
        profile_id: profile.id,
        activity_type: decision.activity,
        presence: decision.presence,
        started_at: atIso,
        transition_reason: decision.transitionReason,
        summary: buildEpisodeSummary({
          decision,
          taskSignals,
          taskId: event.taskId,
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
          ownerMode: nextEnvelope.ownerMode,
        }),
      });

      const state = presenceDb.upsertPresenceState({
        profile_id: profile.id,
        current_activity: decision.activity,
        presence: decision.presence,
        energy: DEFAULT_BUDGETS.energy,
        focus_budget: DEFAULT_BUDGETS.focus_budget,
        social_availability: DEFAULT_BUDGETS.social_availability,
        current_episode_id: episode.id,
        next_review_at: getReviewTimestamp(now, decision.reviewMinutes),
        sleep_window_json: JSON.stringify(sleepWindow),
        policy_version: PRESENCE_POLICY_VERSION,
        state_json: serializePresenceStateEnvelope(nextEnvelope),
      });

      semanticChange = true;
      return buildSnapshot(state, episode);
    }

    const elapsedMinutes = getElapsedMinutes(existingState.updated_at, atIso);
    const driftedBudgets = advancePresenceBudgets(
      existingState.current_activity,
      {
        energy: existingState.energy,
        focus_budget: existingState.focus_budget,
        social_availability: existingState.social_availability,
      },
      elapsedMinutes
    );

    const currentEpisode = existingState.current_episode_id
      ? presenceDb.getPresenceEpisode(existingState.current_episode_id)
      : null;

    let nextEpisode = currentEpisode;
    if (
      shouldStartNewEpisode({
        currentEpisode,
        nextActivity: decision.activity,
        nextPresence: decision.presence,
        nextTransitionReason: decision.transitionReason,
        taskId: event.taskId ?? null,
        threadId: event.threadId ?? null,
      })
    ) {
      if (currentEpisode && !currentEpisode.ended_at) {
        presenceDb.updatePresenceEpisode(currentEpisode.id, {
          ended_at: atIso,
        });
      }

      nextEpisode = presenceDb.addPresenceEpisode({
        profile_id: profile.id,
        activity_type: decision.activity,
        presence: decision.presence,
        started_at: atIso,
        transition_reason: decision.transitionReason,
        summary: buildEpisodeSummary({
          decision,
          taskSignals,
          taskId: event.taskId,
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
          ownerMode: nextEnvelope.ownerMode,
        }),
      });
      semanticChange = true;
    }

    const nextState = presenceDb.upsertPresenceState({
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
      policy_version: PRESENCE_POLICY_VERSION,
      state_json: serializePresenceStateEnvelope(nextEnvelope),
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
    pushPresenceEventToRenderers({
      type: 'presence-state',
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
    const snapshot = reconcilePresenceState({ type: 'tick' });
    if (snapshot) {
      await runDueHourlyRuntimeReflections({ now: snapshot.state.updated_at });
      await runDueDailyRuntimeReflections({ now: snapshot.state.updated_at });
    }
  } catch (error) {
    presenceRuntimeLogger.event({
      level: 'warn',
      event: 'presence.tick',
      outcome: 'failed',
      error,
    });
  } finally {
    tickInFlight = false;
  }
};

export const startPresenceRuntime = () => {
  if (presenceTimer) return;
  presenceTimer = setInterval(() => {
    void tick();
  }, PRESENCE_TICK_MS);
  const snapshot = reconcilePresenceState({ type: 'runtime-start' });
  if (snapshot) {
    void (async () => {
      await runDueHourlyRuntimeReflections({ now: snapshot.state.updated_at });
      await runDueDailyRuntimeReflections({ now: snapshot.state.updated_at });
    })();
  }
};

export const stopPresenceRuntime = () => {
  if (!presenceTimer) return;
  clearInterval(presenceTimer);
  presenceTimer = null;
};

export const recordPresenceRuntimeEvent = (event: PresenceRuntimeEvent): PresenceSnapshot | null =>
  reconcilePresenceState(event);

export const setPresenceOwnerMode = (
  ownerMode: PresenceOwnerMode,
  ownerModeNote?: string | null
): PresenceSnapshot | null =>
  reconcilePresenceState({
    type: 'owner-mode-set',
    ownerMode,
    ownerModeNote: ownerModeNote ?? null,
  });

export const clearPresenceOwnerMode = (): PresenceSnapshot | null =>
  reconcilePresenceState({
    type: 'owner-mode-cleared',
  });

export const getPresenceOverview = (limit = 10): PresenceOverview => {
  const snapshot = reconcilePresenceState({
    type: 'manual-refresh',
    persistAsLastEvent: false,
  });
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) {
    return { snapshot: null, recentEpisodes: [], recentReflections: [] };
  }

  return {
    snapshot,
    recentEpisodes: presenceDb.listPresenceEpisodes(profile.id, limit),
    recentReflections: presenceReflectionDb.listPresenceReflections({
      profileId: profile.id,
      limit: Math.max(1, Math.min(6, limit)),
    }),
  };
};

export const refreshPresenceRuntime = async (): Promise<PresenceSnapshot | null> => {
  const snapshot = reconcilePresenceState({
    type: 'manual-refresh',
  });
  if (snapshot) {
    await runDueHourlyRuntimeReflections({ now: snapshot.state.updated_at });
    await runDueDailyRuntimeReflections({ now: snapshot.state.updated_at });
  }
  return snapshot;
};

const formatPercent = (value: number): string => `${Math.round(clampUnit(value, 0) * 100)}%`;

export const getPresenceContextMessage = (): string => {
  const overview = getPresenceOverview(4);
  const snapshot = overview.snapshot;
  if (!snapshot) return '';

  const lines = [
    'Current presence state for iKi:',
    `- Presence: ${snapshot.state.presence}`,
    `- Activity: ${snapshot.state.current_activity}`,
    `- Day phase: ${snapshot.derived.dayPhase}`,
    snapshot.derived.ownerMode
      ? `- Owner mode: ${snapshot.derived.ownerMode} (${snapshot.derived.ownerModeStatus})`
      : '',
    snapshot.derived.ownerModeNote ? `- Owner mode note: ${snapshot.derived.ownerModeNote}` : '',
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
