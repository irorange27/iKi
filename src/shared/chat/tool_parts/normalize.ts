import type { DynamicToolPart, DynamicToolState } from '../message_parts';
import { isObjectRecord } from '../message_parts';
import { getApprovalIdValue } from './ids';

export const normalizeToolNameKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[-\s]+/g, '_');

export const getToolName = (part: unknown): string => {
  if (!isObjectRecord(part)) return 'tool';

  if (typeof part.toolName === 'string' && part.toolName.trim()) {
    return part.toolName;
  }

  if (isObjectRecord(part.toolCall) && typeof part.toolCall.toolName === 'string') {
    return part.toolCall.toolName;
  }

  if (part.type === 'dynamic-tool' && typeof part.toolName === 'string') {
    return part.toolName;
  }

  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const typeName = part.type.replace(/^tool-/, '');
    if (
      typeName === 'call' ||
      typeName === 'result' ||
      typeName === 'approval-request' ||
      typeName === 'approval-response'
    ) {
      return 'tool';
    }
    return typeName || 'tool';
  }

  return 'tool';
};

export const getToolInput = (part: unknown): unknown => {
  if (!isObjectRecord(part)) return undefined;
  if (part.input !== undefined) return part.input;
  if (part.args !== undefined) return part.args;
  if (isObjectRecord(part.toolCall)) {
    if (part.toolCall.args !== undefined) return part.toolCall.args;
    if (part.toolCall.input !== undefined) return part.toolCall.input;
  }
  return undefined;
};

export const getToolOutput = (part: unknown): unknown => {
  if (!isObjectRecord(part)) return undefined;

  if (part.output !== undefined) return part.output;
  if (part.result !== undefined) return part.result;

  if (part.type === 'tool-approval-response') {
    return {
      approvalId: part.approvalId,
      approved: part.approved,
      reason: part.reason,
    };
  }

  if (isObjectRecord(part.approval) && Object.keys(part.approval).length > 0) {
    return part.approval;
  }

  return undefined;
};

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

const getApprovalIdFromPart = (part: Record<string, unknown>, fallbackId: string): string => {
  return getApprovalIdValue(part) ?? fallbackId;
};

const getErrorTextFromToolPart = (part: Record<string, unknown>): string => {
  if (typeof part.errorText === 'string' && part.errorText.trim()) return part.errorText;
  if (typeof part.output === 'string' && part.output.trim()) return part.output;
  if (isObjectRecord(part.output)) {
    if (typeof part.output.error === 'string' && part.output.error.trim()) return part.output.error;
    if (typeof part.output.message === 'string' && part.output.message.trim()) {
      return part.output.message;
    }
  }
  return 'Tool execution failed';
};

const getDeniedReasonFromToolPart = (part: Record<string, unknown>): string | undefined => {
  if (isObjectRecord(part.approval) && typeof part.approval.reason === 'string') {
    return part.approval.reason;
  }
  if (typeof part.output === 'string' && part.output.trim()) return part.output;
  if (isObjectRecord(part.output) && typeof part.output.message === 'string') {
    return part.output.message;
  }
  return undefined;
};

export const normalizeDynamicToolPart = (
  part: Record<string, unknown>,
  fallbackToolCallId: string
): DynamicToolPart => {
  const toolCallId =
    typeof part.toolCallId === 'string' && part.toolCallId.length > 0
      ? part.toolCallId
      : fallbackToolCallId;
  const toolName =
    typeof part.toolName === 'string' && part.toolName.length > 0 ? part.toolName : 'tool';

  const rawState = typeof part.state === 'string' ? part.state : 'input-available';
  const state = DYNAMIC_TOOL_STATES.has(rawState as DynamicToolState)
    ? (rawState as DynamicToolState)
    : 'input-available';
  const input = part.input ?? {};

  const normalizedBase: DynamicToolPart = {
    type: 'dynamic-tool',
    toolCallId,
    toolName,
  };

  if (typeof part.title === 'string' && part.title.trim()) {
    normalizedBase.title = part.title;
  }
  if (typeof part.providerExecuted === 'boolean') {
    normalizedBase.providerExecuted = part.providerExecuted;
  }
  if (isObjectRecord(part.callProviderMetadata)) {
    normalizedBase.callProviderMetadata = part.callProviderMetadata;
  }

  if (state === 'input-streaming') {
    return { ...normalizedBase, state, input };
  }
  if (state === 'input-available') {
    return { ...normalizedBase, state, input };
  }
  if (state === 'approval-requested') {
    return {
      ...normalizedBase,
      state,
      input,
      approval: {
        id: getApprovalIdFromPart(part, `${toolCallId}_approval`),
      },
    };
  }
  if (state === 'approval-responded') {
    const approved =
      isObjectRecord(part.approval) && typeof part.approval.approved === 'boolean'
        ? part.approval.approved
        : false;
    const reason =
      isObjectRecord(part.approval) && typeof part.approval.reason === 'string'
        ? part.approval.reason
        : undefined;

    return {
      ...normalizedBase,
      state,
      input,
      approval: {
        id: getApprovalIdFromPart(part, `${toolCallId}_approval`),
        approved,
        ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
      },
    };
  }
  if (state === 'output-available') {
    const approval =
      isObjectRecord(part.approval) &&
      typeof part.approval.id === 'string' &&
      part.approval.approved === true
        ? {
            id: part.approval.id,
            approved: true as const,
            ...(typeof part.approval.reason === 'string' && part.approval.reason.length > 0
              ? { reason: part.approval.reason }
              : {}),
          }
        : undefined;

    return {
      ...normalizedBase,
      state,
      input,
      output: part.output ?? null,
      ...(typeof part.preliminary === 'boolean' ? { preliminary: part.preliminary } : {}),
      ...(approval ? { approval } : {}),
    };
  }
  if (state === 'output-error') {
    return {
      ...normalizedBase,
      state,
      input,
      errorText: getErrorTextFromToolPart(part),
    };
  }

  const deniedReason = getDeniedReasonFromToolPart(part);
  return {
    ...normalizedBase,
    state: 'output-denied',
    input,
    approval: {
      id: getApprovalIdFromPart(part, `${toolCallId}_approval`),
      approved: false,
      ...(typeof deniedReason === 'string' && deniedReason.length > 0
        ? { reason: deniedReason }
        : {}),
    },
  };
};
