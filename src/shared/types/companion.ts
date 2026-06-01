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

export type CompanionNudgeKind = 'task-success' | 'task-error' | 'reply-complete';

export interface ConversationPreview {
  threadId: string;
  kind: 'thinking' | 'responding' | 'tool' | 'idle';
  toolName?: string;
  text: string;
}

export interface CompanionAffectHint {
  label: string;
  valence: number;
  arousal: number;
}

export interface CompanionSnapshot {
  phase: CompanionPhase;
  label: string;
  headline: string;
  detail: string;
  updatedAt: string;
  dormantReason?: CompanionDormantReason;
  nudgeKind?: CompanionNudgeKind;
  preview?: ConversationPreview;
  affect?: CompanionAffectHint;
}
