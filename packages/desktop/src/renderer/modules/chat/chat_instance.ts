import { computed, ref } from 'vue';
import { AbstractChat, type ChatState, type ChatStatus } from 'ai';

import type { ChatUiMessage } from '@iki/backend/chat/message_parts';
import { isDynamicToolPart } from '@iki/backend/chat/message_parts';
import { isObjectRecord } from '@iki/backend/utils/guards';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../../logger';
import { recordToolChunkTiming } from './tool_ui_state';
import { createToolApprovalController } from './tool_approval_controller';
import { createIpcChatTransport, type IpcChatTransport } from './ipc_chat_transport';
import { createChatMessageStore, type ChatMessageStore } from './chat_message_store';
import { createUiMessagePersistence, type UiMessagePersistence } from './ui_message_persistence';

const chatInstanceLogger = createLogger({ module: 'chat_instance' });

class IkiChat extends AbstractChat<ChatUiMessage> {}

/** A message worth persisting mid-turn: any tool activity (results, approvals). */
const hasToolActivity = (message: ChatUiMessage | undefined): boolean =>
  Boolean(
    message &&
      message.role === 'assistant' &&
      Array.isArray(message.parts) &&
      message.parts.some(part => isDynamicToolPart(part))
  );

const hasRenderableContent = (message: ChatUiMessage | undefined): boolean => {
  if (!message || !Array.isArray(message.parts)) return false;
  return message.parts.some(part => {
    if (!isObjectRecord(part)) return false;
    if (part.type === 'text') return typeof part.text === 'string' && part.text.trim().length > 0;
    return true;
  });
};

/**
 * Reactive ChatState with in-place array mutations: the renderer message
 * store holds a reference to the same array, so the SDK's message swaps are
 * spliced rather than reassigned. Every mutation triggers Vue reactivity
 * through the shared ref.
 */
const createReactiveChatState = (
  onWrite: (message: ChatUiMessage) => void
): { state: ChatState<ChatUiMessage>; messagesArray: ChatUiMessage[] } => {
  const messagesRef = ref<ChatUiMessage[]>([]);
  const statusRef = ref<ChatStatus>('ready');
  const errorRef = ref<Error | undefined>(undefined);

  const state: ChatState<ChatUiMessage> = {
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
      messagesRef.value.splice(index, 1, message);
      onWrite(message);
    },
    snapshot: <T>(thing: T): T => thing,
  };

  return { state, messagesArray: messagesRef.value };
};

export type ChatInstance = ReturnType<typeof createChatInstance>;

/**
 * Composition root of the renderer chat runtime: the SDK chat instance over
 * the IPC transport, the message-store view, persistence hooks, and the
 * approval controller. One per window; created once by the chat view.
 */
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
  const persistence: UiMessagePersistence = createUiMessagePersistence({
    electronAPI: deps.electronAPI,
  });
  const transport: IpcChatTransport = createIpcChatTransport({
    electronAPI: deps.electronAPI,
  });

  const persistAssistantMessage = async (message: ChatUiMessage, source: string) => {
    // The stream-bound thread wins (approval resumes re-bind it); fall back
    // to the thread the view currently shows.
    const threadId = transport.getBoundThreadId() || deps.getCurrentThreadId();
    if (!threadId) return;

    const messageIndex = messageStore.findIndexById(message.id);
    const parentMessage =
      messageIndex >= 0 ? messageStore.findLatestUserBefore(messageIndex) : undefined;
    const parentId =
      parentMessage && typeof parentMessage.id === 'string' ? parentMessage.id : undefined;

    try {
      await persistence.upsertUiMessage({ message, threadId, parentId, source });
    } catch (error) {
      chatInstanceLogger.event({
        level: 'warn',
        event: 'chat.assistant.persist',
        outcome: 'failed',
        error,
        entity: { thread_id: threadId },
      });
    }
  };

  let midTurnPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleMidTurnPersist = (message: ChatUiMessage) => {
    if (!hasToolActivity(message)) return;
    if (midTurnPersistTimer) clearTimeout(midTurnPersistTimer);
    // Trailing debounce; the captured object is the live SDK state message,
    // so the timer persists the freshest accumulated shape.
    midTurnPersistTimer = setTimeout(() => {
      midTurnPersistTimer = null;
      void persistAssistantMessage(message, 'tool-progress');
    }, 300);
  };

  const { state, messagesArray } = createReactiveChatState(message => {
    deps.onStreamActivity?.();
    scheduleMidTurnPersist(message);
  });

  const messageStore: ChatMessageStore = createChatMessageStore({ messages: messagesArray });
  transport.onChunk(recordToolChunkTiming);

  const chat = new IkiChat({
    generateId: deps.generateId,
    transport,
    state,
    onError: error => {
      chatInstanceLogger.event({
        level: 'error',
        event: 'chat.stream',
        outcome: 'failed',
        message: error.message,
      });
    },
    onFinish: ({ message, isAbort, isError }) => {
      if (midTurnPersistTimer) {
        clearTimeout(midTurnPersistTimer);
        midTurnPersistTimer = null;
      }

      if (!hasRenderableContent(message)) {
        messageStore.removeById(message.id);
        return;
      }

      const finalize = async () => {
        await persistAssistantMessage(message, isAbort ? 'assistant-abort' : 'assistant-response');
        if (isError || isAbort) return;
        const threadId = transport.getBoundThreadId() || deps.getCurrentThreadId();
        if (!threadId) return;
        await deps.onAssistantMessagePersisted?.({
          threadId,
          messagesSnapshot: messageStore.snapshot(),
        });
      };
      void finalize();
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
    persistence,
    status: computed<ChatStatus>(() => state.status),
    error: computed<Error | undefined>(() => state.error),
    activeAssistantMessageId,
    isApprovalProcessing: approvals.isApprovalProcessing,
    handleToolApproval: approvals.handleToolApproval,
  };
};
