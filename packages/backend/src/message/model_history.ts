

export type ModelToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown }
  | { type: 'content'; value: unknown }
  | { type: 'execution-denied'; reason?: string };

export type ModelToolResultContentPart = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output?: unknown;
  [key: string]: unknown;
};

export type ModelToolCallContentPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  [key: string]: unknown;
};

export type ModelContentPart =
  | ModelToolResultContentPart
  | ModelToolCallContentPart
  | { type: string; [key: string]: unknown };

export type ModelMessage =
  | { role: 'system'; content: string | ModelContentPart[] }
  | { role: 'user'; content: string | ModelContentPart[] }
  | { role: 'assistant'; content: string | ModelContentPart[] }

  | { role: 'tool'; content: ModelContentPart[] };

import { createLogger } from '@iki/backend/logger';
import type { ToolApprovalRequest } from '@iki/backend/agent/types';

const logger = createLogger({ module: 'model_history' });

export const cloneModelMessages = (messages?: ModelMessage[]): ModelMessage[] => {
  if (!messages || messages.length === 0) {
    return [];
  }

  return structuredClone(messages);
};

export const appendUserPromptToHistory = (
  history: ModelMessage[],
  prompt: string
): ModelMessage[] => [
  ...history,
  {
    role: 'user',
    content: prompt,
  },
];

export const appendResponseMessages = (
  history: ModelMessage[],
  responseMessages: unknown
): ModelMessage[] => {
  const incrementalMessages = extractResponseMessages(responseMessages);
  if (incrementalMessages.length === 0) {
    return history;
  }

  return [...history, ...incrementalMessages];
};

const isToolCall = (
  value: unknown
): value is { toolName: string; input?: unknown; args?: unknown } =>
  typeof value === 'object' &&
  value !== null &&
  'toolName' in value &&
  typeof (value as { toolName: unknown }).toolName === 'string' &&
  ('input' in value || 'args' in value);

export const normalizeToolArgs = (input: unknown): Record<string, unknown> => {
  if (input === undefined) return {};
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { value: input };
};

const getToolCallInput = (toolCall: { input?: unknown; args?: unknown }): unknown =>
  toolCall.input !== undefined ? toolCall.input : toolCall.args;

export const normalizeCollectedToolCall = (toolCall: {
  toolName: string;
  input?: unknown;
  args?: unknown;
}): { toolName: string; args: Record<string, unknown> } => ({
  toolName: toolCall.toolName,
  args: normalizeToolArgs(getToolCallInput(toolCall)),
});

export const collectToolCalls = (
  steps?: Array<{ toolCalls?: unknown[] }> | null,
  fallbackToolCalls?: unknown[] | null
): Array<{ toolName: string; args: Record<string, unknown> }> | undefined => {
  const toolCalls: Array<{ toolName: string; input?: unknown; args?: unknown }> = [];

  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (Array.isArray(step.toolCalls)) {
        toolCalls.push(...step.toolCalls.filter(isToolCall));
      }
    }
  }

  if (toolCalls.length === 0 && Array.isArray(fallbackToolCalls)) {
    toolCalls.push(...fallbackToolCalls.filter(isToolCall));
  }

  if (toolCalls.length === 0) return undefined;

  return toolCalls.map(normalizeCollectedToolCall);
};

const isApprovalRequestPart = (
  value: unknown
): value is {
  type: 'tool-approval-request';
  approvalId: string;
  toolCall: { toolName: string; toolCallId?: string; input?: unknown; args?: unknown };
} =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 'tool-approval-request' &&
  typeof (value as { approvalId?: unknown }).approvalId === 'string' &&
  typeof (value as { toolCall?: { toolName?: unknown } }).toolCall?.toolName === 'string';

export const collectApprovalRequests = (contentParts: unknown): ToolApprovalRequest[] => {
  if (!Array.isArray(contentParts)) return [];

  return contentParts.filter(isApprovalRequestPart).map(part => {
    const toolCall = normalizeCollectedToolCall(part.toolCall);
    return {
      approvalId: part.approvalId,
      toolCallId: part.toolCall.toolCallId,
      toolCall,
    };
  });
};

const isModelMessageLike = (value: unknown): value is ModelMessage =>
  typeof value === 'object' &&
  value !== null &&
  'role' in value &&
  typeof (value as { role: unknown }).role === 'string' &&
  'content' in value;

export const extractResponseMessages = (responseMessages: unknown): ModelMessage[] =>
  Array.isArray(responseMessages) ? responseMessages.filter(isModelMessageLike) : [];

export type ToolApprovalResponse = {

  type: 'tool-approval-response';
  approvalId: string;
  approved: boolean;
  reason?: string;
};
