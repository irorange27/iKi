import type { ModelMessage, ToolApprovalResponse } from 'ai';

import type { AgentResult, AgentTool, PartialAgentConfig } from '../types';

export type ConversationRunnerStreamEvent = {
  type: string;
  [key: string]: unknown;
};

export type ConversationRunnerStreamOptions = {
  approvalResponses?: ToolApprovalResponse[];
  onStreamPart?: (part: ConversationRunnerStreamEvent) => void;
  abortSignal?: AbortSignal;
};

export type ConversationRunnerRequest = {
  prompt: string;
  history?: ModelMessage[];
};

export type ConversationRunnerGenerateRequest = ConversationRunnerRequest;

export type ConversationRunnerStreamRequest = ConversationRunnerRequest &
  ConversationRunnerStreamOptions;

export interface ConversationRunner {
  registerTool(tool: AgentTool): void;
  generate(request: ConversationRunnerGenerateRequest): Promise<AgentResult>;
  stream(request: ConversationRunnerStreamRequest): AsyncGenerator<string, AgentResult, unknown>;
  getHistory?(): ModelMessage[] | undefined;
}

export type ConversationRunnerFactory = (config?: PartialAgentConfig) => ConversationRunner;
