export type CompanionPhase =
  | 'dormant'
  | 'idle'
  | 'thinking'
  | 'clarify'
  | 'co_plan'
  | 'stabilize'
  | 'execute'
  | 'nudge';

export type CompanionDormantReason = 'provider_missing' | 'model_missing';

export type CompanionNudgeKind = 'task-success' | 'task-error';

export interface CompanionSnapshot {
  phase: CompanionPhase;
  label: string;
  headline: string;
  detail: string;
  updatedAt: string;
  dormantReason?: CompanionDormantReason;
  nudgeKind?: CompanionNudgeKind;
}
