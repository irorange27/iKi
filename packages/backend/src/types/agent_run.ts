export type AgentRunKind =
  | 'chat-turn'
  | 'approval-resume'
  | 'proactive-task'
  | 'awaiter-wake'
  | 'delegated-agent'

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ReviewQueueItem = {
  runId: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  threadId?: string | null;
  threadTitle?: string;
  taskName?: string;
  startedAt: string;
  updatedAt: string;
  summary: string;
  error?: string;
};

/**
 * `finalize` is retained for rows written before a terminal run transition
 * stopped appending a step. Nothing writes it any more: completion, cancellation
 * and approval resume all record the run row alone, because the step duplicated
 * `output.text` and made every turn look like it ended in a separate event.
 */
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

export type AgentRunInput = {
  prompt?: string;
  messages?: unknown[];
  metadata?: Record<string, unknown>;
};

export type AgentRunWorkingState = {
  accumulatedText: string;
  pendingApprovalIds: string[];
  lastStepIndex: number;
};

export type AgentRunOutput = {
  text?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;

  pendingToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
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

export interface AgentRunTrace {
  run: AgentRun;
  steps: AgentRunStep[];
  children: AgentRun[];
}

export interface AgentRunTree {
  rootRunId: string;
  traces: AgentRunTrace[];
}

export type AgentEvalLabelType = 'correct' | 'incorrect' | 'partial' | 'note';

export interface AgentEvalLabel {
  id: string;
  runId: string;
  stepId?: string | null;
  label: AgentEvalLabelType;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvalExportPayload {
  exportedAt: string;
  version: string;
  trace: AgentRunTrace;
  labels: AgentEvalLabel[];
}

