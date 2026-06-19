import type { AgentUsage, ToolApprovalRequest } from './types';

/**
 * Agent step types — canonical `scope_lifecycle` event vocabulary.
 *
 * Each step represents a discrete event in the agent execution cycle.
 * The runner yields these; the chat streaming layer forwards them
 * to the UI emitter and run tracker.
 *
 * Scopes: agent > turn > message > tool_execution
 * Lifecycles: start, update, end
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

export interface ToolInputEndStep {
  type: 'tool_input_end';
  toolCallId: string;
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

export interface SourceStep {
  type: 'source';
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
}

export type AgentStep =
  | MessageUpdateStep
  | ToolExecutionStartStep
  | ToolInputEndStep
  | ToolExecutionEndStep
  | SourceStep
  | ApprovalRequestStep
  | HandoffStep
  | TurnEndStep;
