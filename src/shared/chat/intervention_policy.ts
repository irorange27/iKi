export const INTERVENTION_STATES = [
  'stabilize',
  'clarify',
  'co_plan',
  'guided_execute',
  'autonomous_execute',
] as const;

export type InterventionState = (typeof INTERVENTION_STATES)[number];

export type InterventionPolicySignal = {
  interventionState: InterventionState;
  escalate: 0 | 1;
  confidence: number;
  rationale: string;
  reasonCodes: string[];
  affectUsed: boolean;
  applied?: boolean;
};

export type ChatAffectExperimentMode = 'no_affect' | 'tone_only' | 'explicit_policy';

export type ChatContextMode = 'default' | 'benchmark_clean';

export type ChatExperimentalContext = {
  affectMode?: ChatAffectExperimentMode;
  contextMode?: ChatContextMode;
  awaitRealtimeAffect?: boolean;
};

export const isInterventionState = (value: unknown): value is InterventionState =>
  typeof value === 'string' &&
  INTERVENTION_STATES.includes(value as InterventionState);
