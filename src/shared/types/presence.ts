export type PresenceActivity =
  | 'sleep'
  | 'wake_transition'
  | 'companion_idle'
  | 'focused_work'
  | 'maintenance'
  | 'recovery';

export type PresenceState =
  | 'sleeping'
  | 'waking'
  | 'available'
  | 'focused'
  | 'maintaining'
  | 'recovering';

export type PresenceDayPhase = 'night' | 'wake' | 'day' | 'evening';

export type PresenceOwnerMode = 'sleep' | 'focus' | 'available';
export type PresenceOwnerModeStatus = 'none' | 'applied' | 'deferred';

export type PresenceEventType =
  | 'runtime-start'
  | 'tick'
  | 'manual-refresh'
  | 'task-started'
  | 'task-finished'
  | 'task-failed'
  | 'owner-mode-set'
  | 'owner-mode-cleared';

export type PresenceReflectionPeriodType = 'hour' | 'day';

export interface PresenceStateRecord {
  id: string;
  profile_id: string;
  current_activity: PresenceActivity;
  presence: PresenceState;
  energy: number;
  focus_budget: number;
  social_availability: number;
  current_episode_id?: string | null;
  next_review_at?: string | null;
  sleep_window_json?: string | null;
  policy_version: string;
  state_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PresenceEpisodeRecord {
  id: string;
  profile_id: string;
  activity_type: PresenceActivity;
  presence: PresenceState;
  started_at: string;
  ended_at?: string | null;
  transition_reason: string;
  summary?: string | null;
  trigger_type?: PresenceEventType | null;
  trigger_ref?: string | null;
  thread_id?: string | null;
  client_id?: string | null;
  task_id?: string | null;
  snapshot_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PresenceReflectionRecord {
  id: string;
  profile_id: string;
  period_type: PresenceReflectionPeriodType;
  period_start: string;
  period_end: string;
  summary: string;
  insights_json?: string | null;
  plan_json?: string | null;
  created_at: string;
}

export interface PresenceSleepWindow {
  startHour: number;
  endHour: number;
}

export interface PresenceStateEnvelope {
  dayPhase?: PresenceDayPhase;
  lastTransitionReason?: string;
  lastEventType?: PresenceEventType;
  runningTaskIds?: string[];
  lastTaskFinishedAt?: string | null;
  lastTaskThreadId?: string | null;
  lastTaskStatus?: 'success' | 'error' | null;
  ownerMode?: PresenceOwnerMode | null;
  ownerModeSetAt?: string | null;
  ownerModeNote?: string | null;
}

export interface PresenceTaskSignal {
  runningTaskIds: string[];
  dueTaskCount: number;
  nextDueAt?: string | null;
}

export interface PresenceSignalInput {
  now: Date;
  sleepWindow: PresenceSleepWindow;
  tasks: PresenceTaskSignal;
  ownerMode?: PresenceOwnerMode | null;
}

export interface PresenceActivityDecision {
  activity: PresenceActivity;
  presence: PresenceState;
  dayPhase: PresenceDayPhase;
  transitionReason: string;
  reviewMinutes: number;
}

export interface PresenceSnapshot {
  state: PresenceStateRecord;
  derived: {
    dayPhase: PresenceDayPhase;
    lastTransitionReason?: string;
    lastEventType?: PresenceEventType;
    runningTaskIds: string[];
    ownerMode?: PresenceOwnerMode | null;
    ownerModeSetAt?: string | null;
    ownerModeNote?: string | null;
    ownerModeStatus: PresenceOwnerModeStatus;
  };
  currentEpisode: PresenceEpisodeRecord | null;
}

export interface PresenceOverview {
  snapshot: PresenceSnapshot | null;
  recentEpisodes: PresenceEpisodeRecord[];
  recentReflections: PresenceReflectionRecord[];
}

export interface PresencePushPayload {
  type: 'presence-state';
  snapshot: PresenceSnapshot;
  sourceEvent: PresenceEventType;
}
