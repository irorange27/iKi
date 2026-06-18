import type { ProviderMetadata } from 'ai';

import type { DynamicToolPart, DynamicToolState } from '../message_parts';
import { isObjectRecord } from '../message_parts';
import { getApprovalIdValue, getToolCallIdFromPart } from './ids';
import { unwrapAcpDynamicToolCall } from '../../utils/acp';

export const normalizeToolNameKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[-\s]+/g, '_');

export const getToolName = (part: unknown): string => {
  if (!isObjectRecord(part)) return 'tool';

  const acpDynamicTool = getAcpDynamicToolInput(part);
  if (acpDynamicTool?.toolName) {
    return acpDynamicTool.toolName;
  }

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

const getRawToolInput = (part: unknown): unknown => {
  if (!isObjectRecord(part)) return undefined;
  if (part.input !== undefined) return part.input;
  if (part.args !== undefined) return part.args;
  if (isObjectRecord(part.toolCall)) {
    if (part.toolCall.args !== undefined) return part.toolCall.args;
    if (part.toolCall.input !== undefined) return part.toolCall.input;
  }
  return undefined;
};

export const getToolInput = (part: unknown): unknown => {
  const acpDynamicTool = getAcpDynamicToolInput(part);
  if (acpDynamicTool) {
    return acpDynamicTool.args ?? {};
  }

  return getRawToolInput(part);
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

type DynamicToolBase = {
  type: 'dynamic-tool';
  toolCallId: string;
  toolName: string;
  title?: string;
  providerExecuted?: boolean;
};

const getCallProviderMetadata = (part: Record<string, unknown>): ProviderMetadata | undefined =>
  isObjectRecord(part.callProviderMetadata)
    ? (part.callProviderMetadata as ProviderMetadata)
    : undefined;

const getAcpDynamicToolInput = (
  part: unknown
): { toolCallId?: string; toolName: string; args: unknown } | null => {
  if (!isObjectRecord(part)) return null;

  const partToolName = typeof part.toolName === 'string' ? part.toolName.trim() : '';
  const toolCallToolName =
    isObjectRecord(part.toolCall) && typeof part.toolCall.toolName === 'string'
      ? part.toolCall.toolName.trim()
      : '';
  const effectiveToolName = partToolName || toolCallToolName;

  return unwrapAcpDynamicToolCall({
    toolName: effectiveToolName,
    input: getRawToolInput(part),
  });
};

const toNormalizedDynamicToolState = (
  part: Record<string, unknown>
):
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied' => {
  const rawState = typeof part.state === 'string' ? part.state : 'input-available';

  if (rawState === 'done') {
    if (isObjectRecord(part.approval) && part.approval.approved === false) {
      return 'output-denied';
    }
    if (typeof part.errorText === 'string' && part.errorText.trim()) {
      return 'output-error';
    }
    if (part.output !== undefined || part.result !== undefined) {
      return 'output-available';
    }
    return 'input-available';
  }

  return DYNAMIC_TOOL_STATES.has(rawState as DynamicToolState)
    ? (rawState as Exclude<DynamicToolState, 'done'>)
    : 'input-available';
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

  const state = toNormalizedDynamicToolState(part);
  const input = part.input ?? {};
  const providerMetadata = getCallProviderMetadata(part);

  const normalizedBase: DynamicToolBase = {
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    ...(typeof part.title === 'string' && part.title.trim() ? { title: part.title } : {}),
    ...(typeof part.providerExecuted === 'boolean'
      ? { providerExecuted: part.providerExecuted }
      : {}),
  };

  if (state === 'input-streaming') {
    return { ...normalizedBase, state, input };
  }
  if (state === 'input-available') {
    return {
      ...normalizedBase,
      state,
      input,
      ...(providerMetadata ? { callProviderMetadata: providerMetadata } : {}),
    };
  }
  if (state === 'approval-requested') {
    return {
      ...normalizedBase,
      state,
      input,
      ...(providerMetadata ? { callProviderMetadata: providerMetadata } : {}),
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
      ...(providerMetadata ? { callProviderMetadata: providerMetadata } : {}),
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
      ...(providerMetadata ? { callProviderMetadata: providerMetadata } : {}),
      ...(typeof part.preliminary === 'boolean' ? { preliminary: part.preliminary } : {}),
      ...(approval ? { approval } : {}),
    };
  }
  if (state === 'output-error') {
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
      errorText: getErrorTextFromToolPart(part),
      ...(providerMetadata ? { callProviderMetadata: providerMetadata } : {}),
      ...(approval ? { approval } : {}),
    };
  }

  const deniedReason = getDeniedReasonFromToolPart(part);
  return {
    ...normalizedBase,
    state: 'output-denied',
    input,
    ...(providerMetadata ? { callProviderMetadata: providerMetadata } : {}),
    approval: {
      id: getApprovalIdFromPart(part, `${toolCallId}_approval`),
      approved: false,
      ...(typeof deniedReason === 'string' && deniedReason.length > 0
        ? { reason: deniedReason }
        : {}),
    },
  };
};

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
        ...(typeof part.state === 'string' ? { state: part.state } : {}),
      },
      toolCallId
    );
  }

  if (partType === 'tool-result') {
    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        output: output ?? null,
        state: typeof part.state === 'string' ? part.state : 'output-available',
      },
      toolCallId
    );
  }

  if (partType === 'tool-approval-request') {
    const approvalId = getApprovalIdFromPart(part, `${toolCallId}_approval`);
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
    const approvalId = getApprovalIdFromPart(part, `${toolCallId}_approval`);
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
      ...(typeof part.state === 'string' ? { state: part.state } : {}),
    },
    toolCallId
  );
};
