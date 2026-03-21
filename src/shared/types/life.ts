export type LifeActivity =
  | 'sleep'
  | 'wake_transition'
  | 'companion_idle'
  | 'focused_work'
  | 'maintenance'
  | 'recovery';

export type LifePresence =
  | 'sleeping'
  | 'waking'
  | 'available'
  | 'focused'
  | 'maintaining'
  | 'recovering';

export type LifeDayPhase = 'night' | 'wake' | 'day' | 'evening';

export type LifeEventType =
  | 'runtime-start'
  | 'tick'
  | 'manual-refresh'
  | 'task-started'
  | 'task-finished'
  | 'task-failed';

export interface LifeStateRecord {
  id: string;
  profile_id: string;
  current_activity: LifeActivity;
  presence: LifePresence;
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

export interface LifeEpisodeRecord {
  id: string;
  profile_id: string;
  activity_type: LifeActivity;
  presence: LifePresence;
  started_at: string;
  ended_at?: string | null;
  transition_reason: string;
  summary?: string | null;
  trigger_type?: LifeEventType | null;
  trigger_ref?: string | null;
  thread_id?: string | null;
  client_id?: string | null;
  task_id?: string | null;
  snapshot_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LifeSleepWindow {
  startHour: number;
  endHour: number;
}

export interface LifeStateEnvelope {
  dayPhase?: LifeDayPhase;
  lastTransitionReason?: string;
  lastEventType?: LifeEventType;
  runningTaskIds?: string[];
  lastTaskFinishedAt?: string | null;
  lastTaskThreadId?: string | null;
  lastTaskStatus?: 'success' | 'error' | null;
}

export interface LifeTaskSignal {
  runningTaskIds: string[];
  dueTaskCount: number;
  nextDueAt?: string | null;
}

export interface LifeSignalInput {
  now: Date;
  sleepWindow: LifeSleepWindow;
  tasks: LifeTaskSignal;
}

export interface LifeActivityDecision {
  activity: LifeActivity;
  presence: LifePresence;
  dayPhase: LifeDayPhase;
  transitionReason: string;
  reviewMinutes: number;
}

export interface LifeSnapshot {
  state: LifeStateRecord;
  derived: {
    dayPhase: LifeDayPhase;
    lastTransitionReason?: string;
    lastEventType?: LifeEventType;
    runningTaskIds: string[];
  };
  currentEpisode: LifeEpisodeRecord | null;
}

export interface LifeOverview {
  snapshot: LifeSnapshot | null;
  recentEpisodes: LifeEpisodeRecord[];
}

export interface LifePushPayload {
  type: 'life-state';
  snapshot: LifeSnapshot;
  sourceEvent: LifeEventType;
}
