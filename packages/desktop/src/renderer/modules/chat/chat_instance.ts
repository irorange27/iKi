import { computed, ref } from 'vue';
import { AbstractChat, type ChatState, type ChatStatus } from 'ai';

import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import { isObjectRecord } from '@iki/backend/utils/guards';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../../logger';
import { recordToolChunkTiming } from './tool_ui_state';
import { createToolApprovalController } from './tool_approval_controller';
import { createIpcChatTransport, type IpcChatTransport } from './ipc_chat_transport';
import { createChatMessageStore, type ChatMessageStore } from './chat_message_store';

const chatInstanceLogger = createLogger({ module: 'chat_instance' });

class IkiChat extends AbstractChat<ChatUiMessage> {}

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
export const createReactiveChatState = (
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
      // Tripwire for the streaming-render regression class: writing the
      // identical reference back keeps prop-driven children shallow-equal and
      // their computeds stale (empty chat bubbles). Only a fresh clone per
      // write re-renders; warn loudly if that invariant regresses.
      if (messagesRef.value[index] === message) {
        chatInstanceLogger.event({
          level: 'warn',
          event: 'chat.state.replace_message',
          outcome: 'degraded',
          message:
            'Identical message reference written back; prop-driven message components will not re-render.',
        });
      }
      // The SDK passes the same accumulating raw object every write and mutates
      // its parts off-proxy, so splicing that reference back in leaves the
      // child component's props identical and its segments computed stale.
      // A fresh shallow clone per write gives Vue a new reactive proxy to
      // invalidate on; the parts array itself is still the SDK's live state.
      messagesRef.value.splice(index, 1, { ...message });
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
  // Turn output is durably persisted by the backend conversation seam
  // (thread_session/turn_persistence.ts) — the renderer is a view.
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
    onError: error => {
      chatInstanceLogger.event({
        level: 'error',
        event: 'chat.stream',
        outcome: 'failed',
        message: error.message,
        data: {
          // Reducer failures are state-dependent: dump the fed chunk
          // sequence and the current message part states alongside.
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

      // Title generation hooks the stream settle (the durable record is the
      // backend's concern and does not gate the sidebar title).
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
    status: computed<ChatStatus>(() => state.status),
    error: computed<Error | undefined>(() => state.error),
    activeAssistantMessageId,
    isApprovalProcessing: approvals.isApprovalProcessing,
    handleToolApproval: approvals.handleToolApproval,
  };
};
