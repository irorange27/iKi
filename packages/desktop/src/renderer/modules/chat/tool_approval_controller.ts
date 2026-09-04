import { ref } from 'vue';

import { getApprovalId } from '@iki/backend/chat/tool_parts';
import type { ChatUiMessage } from '@iki/backend/chat/message_parts';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../../logger';
import type { AbstractChat } from 'ai';
import type { IpcChatTransport } from './ipc_chat_transport';

const approvalLogger = createLogger({ module: 'tool_approval_controller' });

export type ToolApprovalController = ReturnType<typeof createToolApprovalController>;

/**
 * Renders the durable approval flow onto the SDK chat: record the decision in
 * the backend's SQLite approval session, mark the part `approval-responded`,
 * then resume the stream the backend pushes over the same IPC channel.
 */
export const createToolApprovalController = (deps: {
  chat: AbstractChat<ChatUiMessage>;
  transport: IpcChatTransport;
  electronAPI: Pick<ElectronApi, 'chat'>;
}) => {
  const processing = ref<Record<string, boolean>>({});

  const isProcessing = (part: unknown): boolean => {
    const approvalId = getApprovalId(part);
    return approvalId ? !!processing.value[approvalId] : false;
  };

  const setProcessing = (approvalId: string, value: boolean) => {
    if (!approvalId) return;
    processing.value = { ...processing.value, [approvalId]: value };
  };

  const handleToolApproval = async (
    _message: ChatUiMessage,
    part: unknown,
    approved: boolean
  ): Promise<void> => {
    const approvalId = getApprovalId(part);
    if (!approvalId) return;
    // Guard against double-clicks: Vue reactivity is async, so a rapid second
    // click can arrive before the button re-renders as disabled.
    if (isProcessing(part)) return;
    setProcessing(approvalId, true);

    try {
      // The backend pushes a resumed stream over the same IPC channel once
      // the decision is recorded; arm the catch-all slot before approving.
      deps.transport.expectFollowUpStream();
      const result = await deps.electronAPI.chat.approveTool(approvalId, approved);
      if (!result?.success) {
        deps.transport.disarmFollowUpStream();
        throw new Error(result?.error || 'Tool approval failed');
      }

      deps.chat.addToolApprovalResponse({
        id: approvalId,
        approved,
        reason: approved ? 'User approved tool execution.' : 'User rejected tool execution.',
      });

      if (!result.awaitingApproval) {
        void deps.chat.resumeStream();
      }
    } catch (error) {
      approvalLogger.event({
        level: 'error',
        event: 'chat.tool_approval',
        outcome: 'failed',
        error,
      });
    } finally {
      setProcessing(approvalId, false);
    }
  };

  return { isApprovalProcessing: isProcessing, handleToolApproval };
};
