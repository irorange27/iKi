/**
 * History and tool-call helpers that USED to live in `ai_sdk_runtime.ts`.
 *
 * That module was the AI SDK adapter, so everything in it looked like it
 * belonged to the SDK. Most of it never did: cloning history, appending a user
 * prompt, collecting tool calls out of step results, reading approval requests
 * out of content parts — all of that operates on iKi's own message and tool
 * shapes. They moved here when the AI SDK adapter was deleted (ADR 009) so the
 * surviving logic has an owner that is not named after a removed dependency.
 */
/**
 * The history entries these helpers manipulate.
 *
 * Deliberately NOT Pi's `Message`: Pi's `AssistantMessage` carries the metadata
 * of a response that already happened (`api`, `provider`, `model`, `responseId`)
 * and its `UserMessage` requires a `timestamp`, so neither is a shape you can
 * build a pending history entry from. This is the small common surface — a role
 * plus content — that both Pi's projection and iKi's own reasoning operate on.
 */
/**
 * A tool result's payload on the wire. Declared here because the Pi harness
 * casts handler output into it; it used to come from the AI SDK's
 * `ToolResultPart['output']`.
 */
export type ModelToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown }
  | { type: 'content'; value: unknown }
  | { type: 'execution-denied'; reason?: string };

/**
 * A discriminated union, not one wide object: call sites narrow it with
 * `Extract<ModelMessage, { role: 'system' }>`, which yields `never` on a
 * single-shape type and silently turns every downstream read into an error.
 */
/**
 * Tool-result part, discriminated by `type`.
 *
 * Declared as its own member (not just `{type: string}`) because callers narrow
 * with `Extract<…, { type: 'tool-result' }>`, which yields `never` against a
 * bare `string` discriminant.
 */
export type ModelToolResultContentPart = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output?: unknown;
  [key: string]: unknown;
};

/** Tool-call part, discriminated the same way. */
export type ModelToolCallContentPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  [key: string]: unknown;
};

/** One content part; the field set is deliberately open because each producer
 * shapes slightly differently and the projections read fields by name. */
export type ModelContentPart =
  | ModelToolResultContentPart
  | ModelToolCallContentPart
  | { type: string; [key: string]: unknown };

export type ModelMessage =
  | { role: 'system'; content: string | ModelContentPart[] }
  | { role: 'user'; content: string | ModelContentPart[] }
  | { role: 'assistant'; content: string | ModelContentPart[] }
  /** Tool messages are ALWAYS a part array: the results must pair by call id. */
  | { role: 'tool'; content: ModelContentPart[] };

import { createLogger } from '@iki/backend/logger';
import { withRetry } from '@iki/backend/utils/retry';
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

/**
 * One answered approval, in the shape the resumed history carries.
 *
 * Used to come from the AI SDK. It is iKi's own record of a decision (which
 * approval, approved or not, and why), so it is declared here.
 */
export type ToolApprovalResponse = {
  /** Part discriminant: these objects ride the resumed history as tool parts. */
  type: 'tool-approval-response';
  approvalId: string;
  approved: boolean;
  reason?: string;
};
