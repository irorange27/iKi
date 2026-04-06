import type {
  PresenceActivity,
  PresenceActivityDecision,
  PresenceDayPhase,
  PresenceOwnerMode,
  PresenceSignalInput,
  PresenceSleepWindow,
  PresenceStateEnvelope,
} from '../../../shared/types/presence';

export const PRESENCE_POLICY_VERSION = 'life-kernel-v2';
export const DEFAULT_SLEEP_WINDOW: PresenceSleepWindow = {
  startHour: 1,
  endHour: 9,
};

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const clampHour = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  if (normalized < 0 || normalized > 23) return fallback;
  return normalized;
};

const normalizeOwnerMode = (value: unknown): PresenceOwnerMode | null =>
  value === 'sleep' || value === 'focus' || value === 'available' ? value : null;

const minutesBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

export const normalizeSleepWindow = (value: unknown): PresenceSleepWindow => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SLEEP_WINDOW };
  const candidate = value as Partial<PresenceSleepWindow>;
  return {
    startHour: clampHour(Number(candidate.startHour), DEFAULT_SLEEP_WINDOW.startHour),
    endHour: clampHour(Number(candidate.endHour), DEFAULT_SLEEP_WINDOW.endHour),
  };
};

export const parsePresenceStateEnvelope = (raw: string | null | undefined): PresenceStateEnvelope => {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<PresenceStateEnvelope> | null;
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      dayPhase:
        parsed.dayPhase === 'night' ||
        parsed.dayPhase === 'wake' ||
        parsed.dayPhase === 'day' ||
        parsed.dayPhase === 'evening'
          ? parsed.dayPhase
          : undefined,
      lastTransitionReason:
        typeof parsed.lastTransitionReason === 'string' ? parsed.lastTransitionReason : undefined,
      lastEventType:
        parsed.lastEventType === 'runtime-start' ||
        parsed.lastEventType === 'tick' ||
        parsed.lastEventType === 'manual-refresh' ||
        parsed.lastEventType === 'task-started' ||
        parsed.lastEventType === 'task-finished' ||
        parsed.lastEventType === 'task-failed' ||
        parsed.lastEventType === 'owner-mode-set' ||
        parsed.lastEventType === 'owner-mode-cleared'
          ? parsed.lastEventType
          : undefined,
      runningTaskIds: Array.isArray(parsed.runningTaskIds)
        ? parsed.runningTaskIds.filter((entry): entry is string => typeof entry === 'string')
        : [],
      lastTaskFinishedAt:
        typeof parsed.lastTaskFinishedAt === 'string' ? parsed.lastTaskFinishedAt : null,
      lastTaskThreadId:
        typeof parsed.lastTaskThreadId === 'string' ? parsed.lastTaskThreadId : null,
      lastTaskStatus:
        parsed.lastTaskStatus === 'success' || parsed.lastTaskStatus === 'error'
          ? parsed.lastTaskStatus
          : null,
      ownerMode: normalizeOwnerMode(parsed.ownerMode),
      ownerModeSetAt: typeof parsed.ownerModeSetAt === 'string' ? parsed.ownerModeSetAt : null,
      ownerModeNote: typeof parsed.ownerModeNote === 'string' ? parsed.ownerModeNote : null,
    };
  } catch {
    return {};
  }
};

export const serializePresenceStateEnvelope = (value: PresenceStateEnvelope): string =>
  JSON.stringify({
    ...(value.dayPhase ? { dayPhase: value.dayPhase } : {}),
    ...(value.lastTransitionReason ? { lastTransitionReason: value.lastTransitionReason } : {}),
    ...(value.lastEventType ? { lastEventType: value.lastEventType } : {}),
    ...(value.runningTaskIds && value.runningTaskIds.length > 0
      ? { runningTaskIds: value.runningTaskIds }
      : { runningTaskIds: [] }),
    ...(value.lastTaskFinishedAt ? { lastTaskFinishedAt: value.lastTaskFinishedAt } : {}),
    ...(value.lastTaskThreadId ? { lastTaskThreadId: value.lastTaskThreadId } : {}),
    ...(value.lastTaskStatus ? { lastTaskStatus: value.lastTaskStatus } : {}),
    ...(value.ownerMode ? { ownerMode: value.ownerMode } : {}),
    ...(value.ownerModeSetAt ? { ownerModeSetAt: value.ownerModeSetAt } : {}),
    ...(value.ownerModeNote ? { ownerModeNote: value.ownerModeNote } : {}),
  });

const isWithinSleepWindow = (date: Date, sleepWindow: PresenceSleepWindow): boolean => {
  const hour = date.getHours();
  if (sleepWindow.startHour === sleepWindow.endHour) return false;
  if (sleepWindow.startHour < sleepWindow.endHour) {
    return hour >= sleepWindow.startHour && hour < sleepWindow.endHour;
  }
  return hour >= sleepWindow.startHour || hour < sleepWindow.endHour;
};

const getLatestWakeBoundary = (date: Date, sleepWindow: PresenceSleepWindow): Date => {
  const boundary = new Date(date);
  boundary.setMinutes(0, 0, 0);
  boundary.setHours(sleepWindow.endHour, 0, 0, 0);
  if (date.getHours() < sleepWindow.endHour) {
    boundary.setDate(boundary.getDate() - 1);
  }
  return boundary;
};

const getMinutesSinceWake = (date: Date, sleepWindow: PresenceSleepWindow): number => {
  if (isWithinSleepWindow(date, sleepWindow)) return 0;
  return minutesBetween(getLatestWakeBoundary(date, sleepWindow), date);
};

export const resolvePresenceDayPhase = (date: Date, sleepWindow: PresenceSleepWindow): PresenceDayPhase => {
  if (isWithinSleepWindow(date, sleepWindow)) return 'night';

  const minutesSinceWake = getMinutesSinceWake(date, sleepWindow);
  if (minutesSinceWake < 45) return 'wake';

  const hour = date.getHours();
  if (hour >= 18 || hour < sleepWindow.startHour) return 'evening';
  return 'day';
};

const hasUpcomingTaskPressure = (params: PresenceSignalInput): boolean => {
  if (params.tasks.dueTaskCount > 0) return true;
  if (!params.tasks.nextDueAt) return false;
  const nextDueAt = new Date(params.tasks.nextDueAt);
  if (Number.isNaN(nextDueAt.getTime())) return false;
  return minutesBetween(params.now, nextDueAt) <= 20;
};

export const choosePresenceActivity = (params: PresenceSignalInput): PresenceActivityDecision => {
  const dayPhase = resolvePresenceDayPhase(params.now, params.sleepWindow);

  if (params.tasks.runningTaskIds.length > 0) {
    return {
      activity: 'focused_work',
      presence: 'focused',
      dayPhase,
      transitionReason: 'task-running',
      reviewMinutes: 15,
    };
  }

  if (params.ownerMode === 'sleep') {
    return {
      activity: 'sleep',
      presence: 'sleeping',
      dayPhase,
      transitionReason: 'owner-mode-sleep',
      reviewMinutes: 20,
    };
  }

  if (params.ownerMode === 'focus') {
    return {
      activity: 'focused_work',
      presence: 'focused',
      dayPhase,
      transitionReason: 'owner-mode-focus',
      reviewMinutes: 15,
    };
  }

  if (params.ownerMode === 'available') {
    return {
      activity: 'companion_idle',
      presence: 'available',
      dayPhase,
      transitionReason: 'owner-mode-available',
      reviewMinutes: 20,
    };
  }

  if (dayPhase === 'night') {
    return {
      activity: 'sleep',
      presence: 'sleeping',
      dayPhase,
      transitionReason: 'sleep-window',
      reviewMinutes: 30,
    };
  }

  if (dayPhase === 'wake') {
    return {
      activity: 'wake_transition',
      presence: 'waking',
      dayPhase,
      transitionReason: 'wake-window',
      reviewMinutes: 15,
    };
  }

  if (hasUpcomingTaskPressure(params)) {
    return {
      activity: 'maintenance',
      presence: 'maintaining',
      dayPhase,
      transitionReason:
        params.tasks.dueTaskCount > 0 ? 'pending-commitments' : 'upcoming-commitment-window',
      reviewMinutes: 15,
    };
  }

  return {
    activity: 'companion_idle',
    presence: 'available',
    dayPhase,
    transitionReason: 'idle-available',
    reviewMinutes: dayPhase === 'evening' ? 45 : 60,
  };
};

const applyActivityDrift = (
  activity: PresenceActivity,
  budgets: { energy: number; focus_budget: number; social_availability: number },
  elapsedMinutes: number
) => {
  if (elapsedMinutes <= 0) return budgets;

  const hours = elapsedMinutes / 60;
  let { energy, focus_budget, social_availability } = budgets;

  switch (activity) {
    case 'sleep':
      energy += 0.24 * hours;
      focus_budget += 0.18 * hours;
      social_availability += 0.08 * hours;
      break;
    case 'wake_transition':
      energy += 0.08 * hours;
      focus_budget += 0.05 * hours;
      social_availability += 0.04 * hours;
      break;
    case 'focused_work':
      energy -= 0.08 * hours;
      focus_budget -= 0.1 * hours;
      social_availability -= 0.05 * hours;
      break;
    case 'maintenance':
      energy -= 0.03 * hours;
      focus_budget -= 0.04 * hours;
      social_availability -= 0.02 * hours;
      break;
    case 'recovery':
      energy += 0.12 * hours;
      focus_budget += 0.08 * hours;
      social_availability += 0.1 * hours;
      break;
    case 'companion_idle':
    default:
      energy += 0.02 * hours;
      focus_budget += 0.03 * hours;
      social_availability += 0.01 * hours;
      break;
  }

  return {
    energy: clampUnit(energy),
    focus_budget: clampUnit(focus_budget),
    social_availability: clampUnit(social_availability),
  };
};

export const advancePresenceBudgets = (
  currentActivity: PresenceActivity,
  budgets: { energy: number; focus_budget: number; social_availability: number },
  elapsedMinutes: number
) => applyActivityDrift(currentActivity, budgets, elapsedMinutes);

export const getReviewTimestamp = (now: Date, reviewMinutes: number): string => {
  const next = new Date(now);
  next.setMinutes(next.getMinutes() + Math.max(1, Math.trunc(reviewMinutes)));
  return next.toISOString();
};
