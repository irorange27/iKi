import type { ToolApprovalResponse } from 'ai';

import type { AgentMessage, AgentResult, AgentTool, PartialAgentConfig } from '../types';

export type ConversationRunnerStreamEvent = {
  type: string;
  [key: string]: unknown;
};

export type ConversationRunnerStreamOptions = {
  approvalResponses?: ToolApprovalResponse[];
  onStreamPart?: (part: ConversationRunnerStreamEvent) => void;
  abortSignal?: AbortSignal;
};

export interface ConversationRunner {
  registerTool(tool: AgentTool): void;
  setMessages(messages: AgentMessage[]): void;
  generate(prompt: string): Promise<AgentResult>;
  stream(
    prompt: string,
    options?: ConversationRunnerStreamOptions
  ): AsyncGenerator<string, AgentResult, unknown>;
}

export type ConversationRunnerFactory = (config?: PartialAgentConfig) => ConversationRunner;
