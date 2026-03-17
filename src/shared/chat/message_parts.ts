import { isObjectRecord } from '../utils/guards';

export { isObjectRecord };

export type TextPart = {
  type: 'text';
  text: string;
  state?: 'streaming' | 'done';
};

export type MemoryResult = Record<string, unknown>;

export type MemoryPart = {
  type: 'memory-retrieval';
  query?: string;
  results?: MemoryResult[];
};

export type ToolApproval = {
  id: string;
  approved?: boolean;
  reason?: string;
};

export type ToolCallRef = {
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  input?: unknown;
};

export type DynamicToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'
  | 'done';

export type DynamicToolPart = {
  type: 'dynamic-tool';
  toolCallId: string;
  toolName: string;
  state?: DynamicToolState;
  title?: string;
  providerExecuted?: boolean;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  preliminary?: boolean;
  approval?: ToolApproval;
  approvalId?: string;
  toolCall?: ToolCallRef;
  args?: unknown;
  result?: unknown;
  callProviderMetadata?: Record<string, unknown>;
};

export type ToolCallPart = {
  type: 'tool-call';
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  args?: unknown;
  toolCall?: ToolCallRef;
  state?: DynamicToolState | string;
};

export type ToolResultPart = {
  type: 'tool-result';
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
  state?: DynamicToolState | string;
};

export type ToolApprovalRequestPart = {
  type: 'tool-approval-request';
  approvalId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  args?: unknown;
  toolCall?: ToolCallRef;
  approval?: ToolApproval;
  state?: DynamicToolState | string;
};

export type ToolApprovalResponsePart = {
  type: 'tool-approval-response';
  approvalId?: string;
  approved?: boolean;
  reason?: string;
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
  approval?: ToolApproval;
  state?: DynamicToolState | string;
};

export type ToolPart =
  | DynamicToolPart
  | ToolCallPart
  | ToolResultPart
  | ToolApprovalRequestPart
  | ToolApprovalResponsePart;

export type UiMessagePart = TextPart | MemoryPart | ToolPart;

export const isTextPart = (part: unknown): part is TextPart =>
  isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string';

export const isMemoryPart = (part: unknown): part is MemoryPart =>
  isObjectRecord(part) && part.type === 'memory-retrieval';

export const isDynamicToolPart = (part: unknown): part is DynamicToolPart =>
  isObjectRecord(part) &&
  part.type === 'dynamic-tool' &&
  typeof part.toolCallId === 'string' &&
  typeof part.toolName === 'string';
