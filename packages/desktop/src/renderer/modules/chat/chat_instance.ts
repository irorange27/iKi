import { computed, ref, shallowRef } from 'vue';
import type { UiChatStatus } from '@iki/backend/message/ui_protocol';
import { IkiChat, type ChatStateAdapter } from './iki_chat';

import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import { isObjectRecord } from '@iki/backend/utils/guards';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../../logger';
import { recordToolChunkTiming } from './tool_ui_state';
import { createToolApprovalController } from './tool_approval_controller';
import { createIpcChatTransport, type IpcChatTransport } from './ipc_chat_transport';
import { createChatMessageStore, type ChatMessageStore } from './chat_message_store';

const chatInstanceLogger = createLogger({ module: 'chat_instance' });

const hasRenderableContent = (message: ChatUiMessage | undefined): boolean => {
  if (!message || !Array.isArray(message.parts)) return false;
  return message.parts.some(part => {
    if (!isObjectRecord(part)) return false;
    if (part.type === 'text') return typeof part.text === 'string' && part.text.trim().length > 0;
    return true;
  });
};

export const createReactiveChatState = (
  onWrite: (message: ChatUiMessage) => void
): { state: ChatStateAdapter; messagesArray: ChatUiMessage[] } => {
  const messagesRef = shallowRef<ChatUiMessage[]>([]);
  const statusRef = ref<UiChatStatus>('ready');
  const errorRef = ref<Error | undefined>(undefined);

  const state: ChatStateAdapter = {
    get status() {
      return statusRef.value;
    },
    set status(next) {
      statusRef.value = next;
    },
    get error() {
      return errorRef.value;
    },
    set error(next) {
      errorRef.value = next;
    },
    get messages() {
      return messagesRef.value;
    },
    set messages(next) {
      messagesRef.value.splice(0, messagesRef.value.length, ...next);
    },
    pushMessage: message => {
      messagesRef.value.push(message);
      onWrite(message);
    },
    popMessage: () => {
      messagesRef.value.pop();
    },
    replaceMessage: (index, message) => {
      if (index < 0 || index >= messagesRef.value.length) return;
      if (messagesRef.value[index] === message) {
        chatInstanceLogger.event({
          level: 'warn',
          event: 'chat.state.replace_message',
          outcome: 'degraded',
          message:
            'Identical message reference written back; prop-driven message components will not re-render.',
        });
      }
      messagesRef.value.splice(index, 1, { ...message });
      onWrite(message);
    },
    snapshot: (thing: ChatUiMessage[]): ChatUiMessage[] => thing,
  };

  return { state, messagesArray: messagesRef.value };
};

export type ChatInstance = ReturnType<typeof createChatInstance>;

export const createChatInstance = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
  generateId: () => string;
  getCurrentThreadId: () => string | null;
  onAssistantMessagePersisted?: (params: {
    threadId: string;
    messagesSnapshot: ChatUiMessage[];
  }) => Promise<void> | void;
  onStreamActivity?: () => void;
}) => {
  const transport: IpcChatTransport = createIpcChatTransport({
    electronAPI: deps.electronAPI,
  });

  const { state, messagesArray } = createReactiveChatState(() => {
    deps.onStreamActivity?.();
  });

  const messageStore: ChatMessageStore = createChatMessageStore({ messages: messagesArray });
  transport.onChunk(recordToolChunkTiming);

  const chat = new IkiChat({
    generateId: deps.generateId,
    transport,
    state,
    chatId: 'iki-chat',
    onError: error => {
      chatInstanceLogger.event({
        level: 'error',
        event: 'chat.stream',
        outcome: 'failed',
        message: error.message,
        data: {
          chunk_traces: transport.getRecentTraces(),
          message_parts: messageStore.messages.map(message => ({
            id: message.id,
            parts: (message.parts ?? [])
              .map(part => {
                if (!isObjectRecord(part)) return 'unknown';
                const record = part as { type?: unknown; toolCallId?: unknown; state?: unknown };
                const descriptor = [String(record.type ?? 'unknown')];
                if (typeof record.toolCallId === 'string') descriptor.push(`:${record.toolCallId}`);
                if (typeof record.state === 'string') descriptor.push(`/${record.state}`);
                return descriptor.join('');
              })
              .join(','),
          })),
        },
      });
    },
    onFinish: ({ message, isAbort, isError }) => {
      if (!hasRenderableContent(message)) {
        messageStore.removeById(message.id);
        return;
      }

      if (isError || isAbort) return;
      const threadId = transport.getBoundThreadId() || deps.getCurrentThreadId();
      if (!threadId) return;
      void deps.onAssistantMessagePersisted?.({
        threadId,
        messagesSnapshot: messageStore.snapshot(),
      });
    },
  });

  const approvals = createToolApprovalController({ chat, transport, electronAPI: deps.electronAPI });

  const activeAssistantMessageId = computed<string | null>(() => {
    const status = state.status;
    if (status !== 'streaming' && status !== 'submitted') return null;
    const messages = messageStore.messages;
    const last = messages[messages.length - 1];
    return last && last.role === 'assistant' && typeof last.id === 'string' ? last.id : null;
  });

  return {
    chat,
    transport,
    messageStore,
    status: computed<UiChatStatus>(() => state.status),
    error: computed<Error | undefined>(() => state.error),
    activeAssistantMessageId,
    isApprovalProcessing: approvals.isApprovalProcessing,
    handleToolApproval: approvals.handleToolApproval,
  };
};
