import type { AgentUsage, ToolApprovalRequest } from './types';

/**
 * Agent step types — iKi-defined, independent of any LLM SDK.
 *
 * Each step represents a discrete event in the agent execution cycle.
 * The runner yields these; the chat streaming layer forwards them
 * to the UI emitter and run tracker.
 */

export interface TextDeltaStep {
  type: 'text-delta';
  text: string;
}

export interface ToolCallStartStep {
  type: 'tool-call-start';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolCallEndStep {
  type: 'tool-call-end';
  toolCallId: string;
}

export interface ToolResultStep {
  type: 'tool-result';
  toolCallId: string;
  output: unknown;
}

export interface ToolErrorStep {
  type: 'tool-error';
  toolCallId: string;
  error: string;
}

export interface ApprovalRequestStep {
  type: 'approval-request';
  requests: ToolApprovalRequest[];
}

export interface ApprovalCollectedStep {
  type: 'approval-collected';
  responses: AgentApprovalResponse[];
}

export interface HandoffStep {
  type: 'handoff';
  summary: string;
  nextSteps: string;
  reason: string;
}

export interface FinishStep {
  type: 'finish';
  text: string;
  usage?: AgentUsage;
}

export interface ErrorStep {
  type: 'error';
  message: string;
  code?: string;
}

export type AgentStep =
  | TextDeltaStep
  | ToolCallStartStep
  | ToolCallEndStep
  | ToolResultStep
  | ToolErrorStep
  | ApprovalRequestStep
  | ApprovalCollectedStep
  | HandoffStep
  | FinishStep
  | ErrorStep;

/** Response to a tool approval request. */
export interface AgentApprovalResponse {
  approvalId: string;
  approved: boolean;
  reason?: string;
}
