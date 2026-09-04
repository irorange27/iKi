import type { AgentUsage, ToolApprovalRequest } from './types';

/**
 * Agent step vocabulary — what `AgentHarness.turn()` yields inside its
 * `TurnEvent` envelope (`{ event: 'step' | 'done' }`).
 *
 * Naming: `message_update` and `tool_execution_start/end` follow the
 * `scope_lifecycle` convention; `approval_request`, `handoff`, and
 * `turn_end` are named protocol events that predate the convention and
 * are deliberately not scope-paired (ADR 001 non-goal: migrating them
 * would rewrite consumers for no behavioral gain).
 *
 * The runner yields these; thread_session forwards them to the UI emitter
 * and the run tracker.
 */

export interface MessageUpdateStep {
  type: 'message_update';
  text: string;
  kind: 'text' | 'reasoning';
}

export interface ToolExecutionStartStep {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolExecutionEndStep {
  type: 'tool_execution_end';
  toolCallId: string;
  outcome: 'success' | 'error';
  output?: unknown;
  error?: string;
}

export interface ApprovalRequestStep {
  type: 'approval_request';
  requests: ToolApprovalRequest[];
}

export interface HandoffStep {
  type: 'handoff';
  summary: string;
  nextSteps: string;
  reason: string;
}

export interface SourceInfo {
  sourceId: string;
  title?: string;
  url?: string;
}

export interface TurnEndStep {
  type: 'turn_end';
  outcome: 'completed' | 'error' | 'cancelled';
  text?: string;
  usage?: AgentUsage;
  message?: string;
  code?: string;
  /** Citations / references produced during the turn. */
  sources?: SourceInfo[];
}

export type AgentStep =
  | MessageUpdateStep
  | ToolExecutionStartStep
  | ToolExecutionEndStep
  | ApprovalRequestStep
  | HandoffStep
  | TurnEndStep;
