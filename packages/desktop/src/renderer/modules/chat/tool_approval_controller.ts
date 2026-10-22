import { ref } from 'vue';

import { getApprovalId } from '@iki/backend/message/tool_parts';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../../logger';
import type { IkiChat } from './iki_chat';
import type { IpcChatTransport } from './ipc_chat_transport';

const approvalLogger = createLogger({ module: 'tool_approval_controller' });

export type ToolApprovalController = ReturnType<typeof createToolApprovalController>;

export const createToolApprovalController = (deps: {
  chat: IkiChat;
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
    if (isProcessing(part)) return;
    setProcessing(approvalId, true);

    try {
      deps.transport.expectFollowUpStream();
      const result = await deps.electronAPI.chat.approveTool(approvalId, approved);
      if (!result?.success) {
        deps.transport.disarmFollowUpStream();
        throw new Error(result?.error || 'Tool approval failed');
      }

      deps.chat.addToolApprovalResponse({
        id: approvalId,
        approved,
      });

      deps.transport.closeFollowUpStream();
      void deps.chat.resumeStream();
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
