import { isObjectRecord } from '../utils/guards';
import type { SkillSource } from '../types/skill';

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

export type SkillUsageEntry = {
  id: string;
  name: string;
  description?: string;
  source?: SkillSource;
};

export type SkillUsagePart = {
  type: 'skill-usage';
  mode?: 'manual' | 'auto';
  skills?: SkillUsageEntry[];
};

export type ContextReportItem = {
  kind?: 'recent-history' | 'identity' | 'thread-summary' | 'memory' | 'affect' | 'skills';
  status?: 'included' | 'truncated' | 'dropped';
  estimatedTokens?: number;
  charCount?: number;
  reason?: string;
  sourceCount?: number;
};

export type ContextReportPart = {
  type: 'context-report';
  totalEstimatedTokens?: number;
  retainedRecentMessages?: number;
  compactedMessages?: number;
  blocks?: ContextReportItem[];
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

export type UiMessagePart = TextPart | MemoryPart | SkillUsagePart | ContextReportPart | ToolPart;

export const isTextPart = (part: unknown): part is TextPart =>
  isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string';

export const isMemoryPart = (part: unknown): part is MemoryPart =>
  isObjectRecord(part) && part.type === 'memory-retrieval';

export const isSkillUsagePart = (part: unknown): part is SkillUsagePart =>
  isObjectRecord(part) && part.type === 'skill-usage';

export const isContextReportPart = (part: unknown): part is ContextReportPart =>
  isObjectRecord(part) && part.type === 'context-report';

export const isDynamicToolPart = (part: unknown): part is DynamicToolPart =>
  isObjectRecord(part) &&
  part.type === 'dynamic-tool' &&
  typeof part.toolCallId === 'string' &&
  typeof part.toolName === 'string';
