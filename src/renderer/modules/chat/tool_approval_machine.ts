import type { UIMessage } from 'ai';
import { ref, type Ref } from 'vue';

import { getApprovalId, getToolCallIdFromPart } from './ui_message_tool_parts';

type ElectronAPI = {
  chat: {
    approveTool: (approvalId: string, approved: boolean) => Promise<{ success?: boolean; error?: string }>;
  };
};

type MessagePartRecord = Record<string, any> & { type: string };

export type ToolApprovalMachine = ReturnType<typeof createToolApprovalMachine>;

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const createToolApprovalMachine = (deps: {
  electronAPI: ElectronAPI;
  chat: { messages: unknown[] };
  createMessageId: () => string;
  getCurrentThreadId: () => string | null;
  isStreamBoundToCurrentThread: () => boolean;
  getOrCreateAssistantMessage: () => UIMessage;
  scrollToBottom: () => void;
  activeStreamThreadId: Ref<string | null>;
  activeAssistantMessageId: Ref<string | null>;
  activeAssistantParentId: Ref<string | null>;
  streamingAssistantText: Ref<string>;
  streamRenderTraceId: Ref<string>;
  streamRenderChunkCount: Ref<number>;
  streamRenderChars: Ref<number>;
  upsertUiMessage: (params: {
    message: UIMessage;
    threadId: string;
    parentId?: string;
    source?: string;
  }) => Promise<void>;
}) => {
  const approvalProcessing = ref<Record<string, boolean>>({});

  const isApprovalProcessing = (part: unknown): boolean => {
    const approvalId = getApprovalId(part);
    return approvalId ? !!approvalProcessing.value[approvalId] : false;
  };

  const resetApprovalProcessing = () => {
    approvalProcessing.value = {};
  };

  const handleToolApprovalRequest = async (request: any): Promise<void> => {
    if (!deps.isStreamBoundToCurrentThread()) return;
    const streamThreadId = deps.activeStreamThreadId.value || deps.getCurrentThreadId() || '';
    if (!streamThreadId) return;

    const assistantMessage = deps.getOrCreateAssistantMessage();
    const requestedToolCallId = request.toolCallId || request.toolCall?.toolCallId;
    const existingPartIndex = assistantMessage.parts.findIndex(part => {
      if (getApprovalId(part) === request.approvalId) return true;
      if (!requestedToolCallId) return false;
      return getToolCallIdFromPart(part) === requestedToolCallId;
    });

    const existingPart =
      existingPartIndex >= 0 && typeof assistantMessage.parts[existingPartIndex] === 'object'
        ? (assistantMessage.parts[existingPartIndex] as MessagePartRecord)
        : undefined;

    const approvalPart: MessagePartRecord = {
      ...(existingPart || {}),
      type: 'dynamic-tool',
      toolName: request.toolCall?.toolName || existingPart?.toolName || 'tool',
      toolCallId:
        requestedToolCallId || getToolCallIdFromPart(existingPart) || deps.createMessageId(),
      input: request.toolCall?.args ?? existingPart?.input ?? {},
      state: 'approval-requested',
      approval: {
        id: request.approvalId,
      },
    };

    if (typeof approvalPart.startedAt !== 'number' || !Number.isFinite(approvalPart.startedAt)) {
      approvalPart.startedAt = Date.now();
    }
    delete approvalPart.endedAt;
    delete approvalPart.durationMs;

    if (existingPartIndex >= 0) {
      assistantMessage.parts.splice(existingPartIndex, 1, approvalPart as any);
    } else {
      assistantMessage.parts.push(approvalPart as any);
    }

    const assistantMessageToPersist =
      existingPartIndex >= 0
        ? ({
            ...assistantMessage,
            parts: [...assistantMessage.parts],
          } as UIMessage)
        : assistantMessage;

    await deps.upsertUiMessage({
      message: assistantMessageToPersist,
      parentId: deps.activeAssistantParentId.value || undefined,
      source: 'tool-approval-request',
      threadId: streamThreadId,
    });

    deps.scrollToBottom();
  };

  const handleToolApproval = async (
    message: UIMessage,
    part: any,
    approved: boolean
  ): Promise<void> => {
    const approvalId = getApprovalId(part);
    if (!approvalId) return;

    // After a reload, transient streaming state is empty, so UI chunks from a resumed approval would be ignored.
    // Re-bind the stream to the current thread + assistant message so resume works reliably.
    const currentThreadId = deps.getCurrentThreadId();
    if (currentThreadId) {
      deps.activeStreamThreadId.value = currentThreadId;
    }
    if (message?.id) {
      deps.activeAssistantMessageId.value = message.id;
    }
    if (!deps.activeAssistantParentId.value && message?.id) {
      const messageIndex = deps.chat.messages.findIndex((m: any) => m && m.id === message.id);
      if (messageIndex >= 0) {
        const parent = [...deps.chat.messages.slice(0, messageIndex)]
          .reverse()
          .find((m: any) => m && m.role === 'user' && typeof m.id === 'string');
        if (isObjectRecord(parent) && typeof parent.id === 'string') {
          deps.activeAssistantParentId.value = parent.id;
        }
      }
    }
    deps.streamingAssistantText.value = '';
    deps.streamRenderTraceId.value = `approval-${Date.now()}`;
    deps.streamRenderChunkCount.value = 0;
    deps.streamRenderChars.value = 0;

    approvalProcessing.value[approvalId] = true;

    try {
      const result = await deps.electronAPI.chat.approveTool(approvalId, approved);
      if (!result?.success) {
        throw new Error(result?.error || 'Tool approval failed');
      }

      if (approved) {
        part.state = 'approval-responded';
        part.approval = {
          id: approvalId,
          approved: true,
          reason: 'User approved tool execution.',
        };
      } else {
        const nowMs = Date.now();
        if (typeof part.startedAt !== 'number' || !Number.isFinite(part.startedAt)) {
          part.startedAt = nowMs;
        }
        part.endedAt = nowMs;
        part.durationMs = Math.max(0, nowMs - (part.startedAt as number));
        part.state = 'output-denied';
        part.approval = {
          id: approvalId,
          approved: false,
          reason: 'User rejected tool execution.',
        };
      }

      const threadId = deps.activeStreamThreadId.value || deps.getCurrentThreadId() || '';
      if (threadId) {
        await deps.upsertUiMessage({
          message,
          parentId: deps.activeAssistantParentId.value || undefined,
          source: approved ? 'tool-approval:approve' : 'tool-approval:reject',
          threadId,
        });
      }
    } catch (error) {
      console.error('Failed to approve tool:', error);
    } finally {
      approvalProcessing.value[approvalId] = false;
    }
  };

  return {
    approvalProcessing: approvalProcessing as Ref<Record<string, boolean>>,
    handleToolApproval,
    handleToolApprovalRequest,
    isApprovalProcessing,
    resetApprovalProcessing,
  };
};
