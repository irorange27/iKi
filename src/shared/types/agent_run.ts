export type AgentRunKind =
  | 'chat-turn'
  | 'approval-resume'
  | 'proactive-task'
  | 'awaiter-wake'
  | 'delegated-agent';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentRunStepType =
  | 'model'
  | 'tool-call'
  | 'tool-result'
  | 'approval-request'
  | 'approval-response'
  | 'child-run'
  | 'finalize'
  | 'error';

export type AgentRunStepStatus = 'started' | 'completed' | 'failed';

export type AgentRunCheckpointReason =
  | 'step-completed'
  | 'approval-requested'
  | 'approval-answered'
  | 'child-run-spawned'
  | 'run-completed'
  | 'run-cancelled'
  | 'run-failed';

export type AgentRunInput = {
  prompt?: string;
  messages?: unknown[];
  metadata?: Record<string, unknown>;
};

export type AgentRunWorkingState = {
  modelMessages: unknown[];
  accumulatedText: string;
  pendingApprovalIds: string[];
  lastStepIndex: number;
};

export type AgentRunOutput = {
  text?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
};

export type AgentRunError = {
  message: string;
  code?: string;
  retryable?: boolean;
};

export interface AgentRun {
  id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  threadId?: string | null;
  parentRunId?: string | null;
  rootRunId: string;
  providerType: string;
  providerId?: string | null;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
  availableSkillIds: string[];
  input: AgentRunInput;
  working: AgentRunWorkingState;
  output?: AgentRunOutput | null;
  error?: AgentRunError | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunStep {
  id: string;
  runId: string;
  stepIndex: number;
  type: AgentRunStepType;
  status: AgentRunStepStatus;
  summary: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface AgentRunCheckpoint {
  id: string;
  runId: string;
  stepIndex: number;
  reason: AgentRunCheckpointReason;
  snapshot: AgentRun;
  createdAt: string;
}

export interface AgentRunTrace {
  run: AgentRun;
  steps: AgentRunStep[];
  latestCheckpoint?: AgentRunCheckpoint | null;
  children: AgentRun[];
}

export interface AgentRunTree {
  rootRunId: string;
  traces: AgentRunTrace[];
}
