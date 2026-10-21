import type { AgentUsage, ToolApprovalRequest } from './types';
import type { ModelMessage } from '../message/model_history';

export type ModelInferenceRecord = {
  messages: ModelMessage[];
  systemPrompt: string;
  content: unknown[];
  finishReason?: string;
  usage: AgentUsage;
};

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

  sources?: SourceInfo[];
}

export type AgentStep =
  | MessageUpdateStep
  | ToolExecutionStartStep
  | ToolExecutionEndStep
  | ApprovalRequestStep
  | TurnEndStep;
