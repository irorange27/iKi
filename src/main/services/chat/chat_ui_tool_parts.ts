import type { DynamicToolPart, DynamicToolState } from '../../../shared/chat/message_parts';
import {
  getApprovalId,
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  getToolOutput,
  normalizeDynamicToolPart,
} from '../../../shared/chat/tool_parts';

export const createRuntimeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const DYNAMIC_TOOL_STATES = new Set<DynamicToolState>([
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
  'done',
]);

const isDynamicToolState = (value: unknown): value is DynamicToolState =>
  typeof value === 'string' && DYNAMIC_TOOL_STATES.has(value as DynamicToolState);

export const normalizeToolPartForValidation = (
  part: Record<string, unknown>,
  fallbackToolCallId: string
): DynamicToolPart | null => {
  const partType = typeof part.type === 'string' ? part.type : '';
  if (!partType) return null;

  if (partType === 'dynamic-tool') {
    return normalizeDynamicToolPart(part, fallbackToolCallId);
  }

  if (!partType.startsWith('tool-')) return null;

  const toolCallId = getToolCallIdFromPart(part) ?? fallbackToolCallId;
  const baseToolName = getToolName(part) || 'tool';
  const input = getToolInput(part);
  const output = getToolOutput(part);

  if (partType === 'tool-call') {
    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        ...(isDynamicToolState(part.state) ? { state: part.state } : {}),
      },
      toolCallId
    );
  }

  if (partType === 'tool-result') {
    const nextState = isDynamicToolState(part.state) ? part.state : 'output-available';
    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        output: output ?? null,
        state: nextState,
      },
      toolCallId
    );
  }

  if (partType === 'tool-approval-request') {
    const approvalId = getApprovalId(part) ?? `${toolCallId}_approval`;
    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        state: 'approval-requested',
        approval: { id: approvalId },
      },
      toolCallId
    );
  }

  if (partType === 'tool-approval-response') {
    const approvalId = getApprovalId(part) ?? `${toolCallId}_approval`;
    const approved = typeof part.approved === 'boolean' ? part.approved : false;
    const reason =
      typeof part.reason === 'string' && part.reason.trim().length > 0 ? part.reason : undefined;
    const approval = {
      id: approvalId,
      approved,
      ...(reason ? { reason } : {}),
    };

    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        state: approved ? 'approval-responded' : 'output-denied',
        approval,
      },
      toolCallId
    );
  }

  const inferredToolName = partType.slice(5).trim();
  return normalizeDynamicToolPart(
    {
      ...part,
      toolCallId,
      toolName: inferredToolName || baseToolName,
      input: input ?? {},
      ...(output !== undefined ? { output } : {}),
      ...(isDynamicToolState(part.state) ? { state: part.state } : {}),
    },
    toolCallId
  );
};
