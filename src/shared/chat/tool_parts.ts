type ToolPartRecord = Record<string, any> & { type: string };

export const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getApprovalId = (part: unknown): string | null => {
  if (!isObjectRecord(part)) return null;
  if (typeof part.approvalId === 'string') return part.approvalId;
  if (!isObjectRecord(part.approval)) return null;
  return typeof part.approval.id === 'string' ? part.approval.id : null;
};

export const getToolCallIdFromPart = (part: unknown): string | null => {
  if (!isObjectRecord(part)) return null;
  if (typeof part.toolCallId === 'string' && part.toolCallId.length > 0) return part.toolCallId;
  if (typeof part.id === 'string' && part.id.length > 0) return part.id;
  if (isObjectRecord(part.toolCall) && typeof part.toolCall.toolCallId === 'string') {
    return part.toolCall.toolCallId;
  }
  return null;
};

export const parseToolInputFromText = (inputText: string): unknown => {
  const trimmedInput = inputText.trim();
  if (!trimmedInput) return {};

  try {
    return JSON.parse(trimmedInput);
  } catch {
    return inputText;
  }
};

export const isToolPart = (part: unknown): part is ToolPartRecord =>
  isObjectRecord(part) &&
  typeof part.type === 'string' &&
  (part.type === 'dynamic-tool' || part.type.startsWith('tool-'));

export const isApprovalRequestedPart = (part: unknown): boolean => {
  if (!isToolPart(part)) return false;
  if (!getApprovalId(part)) return false;
  return part.type === 'tool-approval-request' || part.state === 'approval-requested';
};

export const isToolResultPart = (part: unknown): boolean => {
  if (!isToolPart(part) || !isObjectRecord(part) || isApprovalRequestedPart(part)) return false;

  if (part.type === 'tool-result' || part.type === 'tool-approval-response') return true;
  if (part.output !== undefined || part.result !== undefined) return true;

  if (typeof part.state === 'string') {
    return (
      part.state === 'approval-responded' ||
      part.state === 'done' ||
      part.state.startsWith('output-')
    );
  }

  return false;
};

export const isToolCallPart = (part: unknown): boolean =>
  isToolPart(part) && !isApprovalRequestedPart(part) && !isToolResultPart(part);

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

export const normalizeToolNameKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[-\s]+/g, '_');

type DynamicToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

const DYNAMIC_TOOL_STATES = new Set<DynamicToolState>([
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
]);

const getApprovalIdFromPart = (part: Record<string, unknown>, fallbackId: string): string => {
  if (typeof part.approvalId === 'string' && part.approvalId.length > 0) return part.approvalId;
  if (isObjectRecord(part.approval) && typeof part.approval.id === 'string' && part.approval.id) {
    return part.approval.id;
  }
  return fallbackId;
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
): Record<string, unknown> => {
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

  const normalizedBase: Record<string, unknown> = {
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
