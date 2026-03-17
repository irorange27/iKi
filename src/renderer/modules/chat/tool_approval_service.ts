import type { UIMessage } from 'ai';
import { ref, type Ref } from 'vue';

import { getApprovalId, getToolCallIdFromPart } from './ui_message_tool_parts';
import {
  isDynamicToolPart,
  type DynamicToolPart,
  type UiMessagePart,
} from '../../../shared/chat/message_parts';

export type ApprovalRequestPayload = {
  approvalId: string;
  toolCallId?: string;
  toolCall?: {
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
  };
};

export type ApprovalRequestedEvent = {
  type: 'approval_requested';
  request: ApprovalRequestPayload;
  nowMs?: number;
};

export type ApprovalResolvedEvent = {
  type: 'approval_approved' | 'approval_rejected';
  approvalId: string;
  approved: boolean;
  reason?: string;
  nowMs?: number;
};

export type ApprovalEvent = ApprovalRequestedEvent | ApprovalResolvedEvent;

export type ApprovalPatch = {
  message: UIMessage;
  didChange: boolean;
};

export type ToolApprovalService = ReturnType<typeof createToolApprovalService>;

export const createToolApprovalService = (deps: { createMessageId: () => string }) => {
  const approvalProcessing = ref<Record<string, boolean>>({});

  const isApprovalProcessing = (part: unknown): boolean => {
    const approvalId = getApprovalId(part);
    return approvalId ? !!approvalProcessing.value[approvalId] : false;
  };

  const setApprovalProcessing = (approvalId: string, processing: boolean) => {
    if (!approvalId) return;
    approvalProcessing.value[approvalId] = processing;
  };

  const resetApprovalProcessing = () => {
    approvalProcessing.value = {};
  };

  const applyApprovalEvent = (message: UIMessage, event: ApprovalEvent): ApprovalPatch => {
    if (!message || !Array.isArray(message.parts)) {
      return { message, didChange: false };
    }

    const parts = [...(message.parts as UiMessagePart[])];

    if (event.type === 'approval_requested') {
      const request = event.request;
      const requestedToolCallId = request.toolCallId || request.toolCall?.toolCallId;
      const existingPartIndex = parts.findIndex(part => {
        if (getApprovalId(part) === request.approvalId) return true;
        if (!requestedToolCallId) return false;
        return getToolCallIdFromPart(part) === requestedToolCallId;
      });

      const existingPart =
        existingPartIndex >= 0 ? parts[existingPartIndex] : undefined;
      const existingToolPart = isDynamicToolPart(existingPart) ? existingPart : undefined;

      const toolCallId =
        requestedToolCallId || getToolCallIdFromPart(existingPart) || deps.createMessageId();
      const approvalPart: DynamicToolPart = {
        ...(existingToolPart || {}),
        type: 'dynamic-tool',
        toolName: request.toolCall?.toolName || existingToolPart?.toolName || 'tool',
        toolCallId,
        input: request.toolCall?.args ?? existingToolPart?.input ?? {},
        state: 'approval-requested',
        approval: {
          id: request.approvalId,
        },
      };

      if (existingPartIndex >= 0) {
        parts[existingPartIndex] = approvalPart;
      } else {
        parts.push(approvalPart);
      }

      return {
        message: { ...message, parts: parts as UIMessage['parts'] },
        didChange: true,
      };
    }

    const approvalId = event.approvalId;
    if (!approvalId) {
      return { message, didChange: false };
    }

    const partIndex = parts.findIndex(part => getApprovalId(part) === approvalId);
    if (partIndex < 0) {
      return { message, didChange: false };
    }

    const part: DynamicToolPart = isDynamicToolPart(parts[partIndex])
      ? { ...(parts[partIndex] as DynamicToolPart) }
      : {
          type: 'dynamic-tool',
          toolCallId: getToolCallIdFromPart(parts[partIndex]) || deps.createMessageId(),
          toolName: 'tool',
        };

    if (event.approved) {
      part.state = 'approval-responded';
      part.approval = {
        id: approvalId,
        approved: true,
        reason: event.reason || 'User approved tool execution.',
      };
    } else {
      part.state = 'output-denied';
      part.approval = {
        id: approvalId,
        approved: false,
        reason: event.reason || 'User rejected tool execution.',
      };
    }

    parts[partIndex] = part;

    return {
      message: { ...message, parts: parts as UIMessage['parts'] },
      didChange: true,
    };
  };

  return {
    approvalProcessing: approvalProcessing as Ref<Record<string, boolean>>,
    applyApprovalEvent,
    isApprovalProcessing,
    resetApprovalProcessing,
    setApprovalProcessing,
  };
};
