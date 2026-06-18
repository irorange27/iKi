import { ref, type Ref } from 'vue';

import { getApprovalId, getToolCallIdFromPart } from './ui_message_tool_parts';
import {
  type ChatUiMessage,
  isDynamicToolPart,
} from '@iki/core/chat/message_parts';
import { normalizeToolPartForValidation } from '@iki/core/chat/tool_parts';

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
  message: ChatUiMessage;
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

  const applyApprovalEvent = (message: ChatUiMessage, event: ApprovalEvent): ApprovalPatch => {
    if (!message || !Array.isArray(message.parts)) {
      return { message, didChange: false };
    }

    const parts = [...message.parts];

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
      const approvalPart = normalizeToolPartForValidation(
        {
          ...(existingToolPart || {}),
          type: 'dynamic-tool',
          toolName: request.toolCall?.toolName || existingToolPart?.toolName || 'tool',
          toolCallId,
          input: request.toolCall?.args ?? existingToolPart?.input ?? {},
          state: 'approval-requested',
          approval: {
            id: request.approvalId,
          },
        },
        toolCallId
      );

      if (!approvalPart) {
        return { message, didChange: false };
      }

      if (existingPartIndex >= 0) {
        parts[existingPartIndex] = approvalPart;
      } else {
        parts.push(approvalPart);
      }

      return {
        message: { ...message, parts },
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

    const existingPart = parts[partIndex];
    const existingToolPart = isDynamicToolPart(existingPart) ? existingPart : undefined;
    const toolCallId = getToolCallIdFromPart(existingPart) || deps.createMessageId();
    const part = normalizeToolPartForValidation(
      {
        ...(existingToolPart || {}),
        type: 'dynamic-tool',
        toolCallId,
        toolName: existingToolPart?.toolName || 'tool',
        input: existingToolPart?.input ?? {},
        state: event.approved ? 'approval-responded' : 'output-denied',
        approval: {
          id: approvalId,
          approved: event.approved,
          reason:
            event.reason ||
            (event.approved
              ? 'User approved tool execution.'
              : 'User rejected tool execution.'),
        },
      },
      toolCallId
    );

    if (!part) {
      return { message, didChange: false };
    }

    parts[partIndex] = part;

    return {
      message: { ...message, parts },
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
