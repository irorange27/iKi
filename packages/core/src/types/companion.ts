export type CompanionPhase = 'dormant' | 'idle' | 'thinking' | 'nudge';

export type CompanionDormantReason = 'provider_missing' | 'model_missing';

export interface ConversationPreview {
  threadId: string;
  kind: 'thinking' | 'responding' | 'tool' | 'idle';
  toolName?: string;
  text: string;
}

export interface CompanionSnapshot {
  phase: CompanionPhase;
  label: string;
  headline: string;
  detail: string;
  updatedAt: string;
  dormantReason?: CompanionDormantReason;
  preview?: ConversationPreview;
}
