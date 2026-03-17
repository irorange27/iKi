import type { UIMessage, UIMessageChunk } from 'ai';
import { ref, type Ref } from 'vue';

import type { UiMessagePersistence } from './ui_message_persistence';
import {
  createInitialStreamState,
  reduceStream,
  type MessageOp,
  type StreamAction,
  type StreamEffect,
  type StreamState,
} from './ui_stream_reducer';
import { createToolApprovalMachine } from './tool_approval_machine';

type ElectronAPI = {
  chat: {
    stopStream: () => Promise<unknown>;
    approveTool: (approvalId: string, approved: boolean) => Promise<{ success?: boolean; error?: string }>;
  };
};

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMemoryRetrievalChunk = (
  chunk: Record<string, unknown>
): chunk is { type: 'memory-retrieval'; query?: unknown; results?: unknown } =>
  chunk.type === 'memory-retrieval';

export type ChatUiStreamController = ReturnType<typeof createChatUiStreamController>;

export const createChatUiStreamController = (deps: {
  chat: { messages: unknown[] };
  electronAPI: ElectronAPI;
  persistence: UiMessagePersistence;
  createMessageId: () => string;
  scrollToBottom: () => void;
  getCurrentThreadId: () => string | null;
  onAssistantMessagePersisted?: (params: { threadId: string; messagesSnapshot: UIMessage[] }) => Promise<void> | void;
}) => {
  const initialState = createInitialStreamState();
  const activeAssistantMessageId = ref<string | null>(initialState.activeAssistantMessageId);
  const activeAssistantParentId = ref<string | null>(initialState.activeAssistantParentId);
  const activeStreamThreadId = ref<string | null>(initialState.activeStreamThreadId);
  const streamingAssistantText = ref(initialState.streamingAssistantText);
  const streamRenderTick = ref(initialState.streamRenderTick);
  const streamRenderTraceId = ref(initialState.streamRenderTraceId);
  const streamRenderChunkCount = ref(initialState.streamRenderChunkCount);
  const streamRenderChars = ref(initialState.streamRenderChars);

  const getAssistantMessageById = (id: string | null): UIMessage | undefined => {
    if (!id) return undefined;
    return deps.chat.messages.find((message: any) => message.id === id) as UIMessage | undefined;
  };

  const getOrCreateAssistantMessage = (): UIMessage => {
    const existing = getAssistantMessageById(activeAssistantMessageId.value);
    if (existing) return existing;

    const assistantMessage: UIMessage = {
      id: deps.createMessageId(),
      role: 'assistant',
      parts: [],
    };

    deps.chat.messages.push(assistantMessage as any);
    activeAssistantMessageId.value = assistantMessage.id;
    return assistantMessage;
  };

  const isStreamBoundToCurrentThread = (): boolean => {
    if (!activeStreamThreadId.value) return false;
    return deps.getCurrentThreadId() === activeStreamThreadId.value;
  };

  const getStateFromRefs = (): StreamState => ({
    activeAssistantMessageId: activeAssistantMessageId.value,
    activeAssistantParentId: activeAssistantParentId.value,
    activeStreamThreadId: activeStreamThreadId.value,
    streamingAssistantText: streamingAssistantText.value,
    streamRenderTick: streamRenderTick.value,
    streamRenderTraceId: streamRenderTraceId.value,
    streamRenderChunkCount: streamRenderChunkCount.value,
    streamRenderChars: streamRenderChars.value,
  });

  const commitStateToRefs = (state: StreamState) => {
    activeAssistantMessageId.value = state.activeAssistantMessageId;
    activeAssistantParentId.value = state.activeAssistantParentId;
    activeStreamThreadId.value = state.activeStreamThreadId;
    streamingAssistantText.value = state.streamingAssistantText;
    streamRenderTick.value = state.streamRenderTick;
    streamRenderTraceId.value = state.streamRenderTraceId;
    streamRenderChunkCount.value = state.streamRenderChunkCount;
    streamRenderChars.value = state.streamRenderChars;
  };

  const applyMessageOps = (ops: MessageOp[]) => {
    if (ops.length === 0) return;
    for (const op of ops) {
      if (op.type === 'append') {
        deps.chat.messages.push(op.message as any);
        continue;
      }

      const index = deps.chat.messages.findIndex((message: any) => message.id === op.messageId);
      if (op.type === 'replace') {
        if (index >= 0) {
          deps.chat.messages.splice(index, 1, op.message as any);
        } else {
          deps.chat.messages.push(op.message as any);
        }
        continue;
      }

      if (op.type === 'remove') {
        if (index >= 0) {
          deps.chat.messages.splice(index, 1);
        }
      }
    }
  };

  const runEffects = async (effects: StreamEffect[]) => {
    for (const effect of effects) {
      if (effect.type === 'scroll') {
        deps.scrollToBottom();
        continue;
      }
      if (effect.type === 'log') {
        const logger = effect.level === 'warn' ? console.warn : effect.level === 'error' ? console.error : console.log;
        logger(effect.message);
        continue;
      }
      if (effect.type === 'persist') {
        if (!effect.threadId) continue;
        await deps.persistence.upsertUiMessage({
          message: effect.message,
          parentId: effect.parentId,
          source: effect.source,
          threadId: effect.threadId,
        });
        continue;
      }
      if (effect.type === 'notify_persisted') {
        if (!effect.shouldNotify) continue;
        const messagesSnapshot = [...(deps.chat.messages as UIMessage[])];
        await Promise.resolve(
          deps.onAssistantMessagePersisted?.({
            threadId: effect.threadId,
            messagesSnapshot,
          })
        );
        continue;
      }
      if (effect.type === 'approval_request') {
        await approvals.handleToolApprovalRequest(effect.payload);
        continue;
      }
      if (effect.type === 'reset_approvals') {
        approvals.resetApprovalProcessing();
      }
    }
  };

  const dispatch = async (action: StreamAction) => {
    const state = getStateFromRefs();
    const context = {
      messages: deps.chat.messages as UIMessage[],
      createMessageId: deps.createMessageId,
      currentThreadId: deps.getCurrentThreadId(),
      nowMs: Date.now(),
    };

    const result = reduceStream(state, context, action);
    commitStateToRefs(result.state);
    applyMessageOps(result.messageOps);
    await runEffects(result.effects);
  };

  const resetTransientState = async () => {
    await dispatch({ type: 'reset' });
  };

  const resetTransientStateSync = (): void => {
    void resetTransientState();
  };

  const stopActiveStreamIfNeeded = async (reason: string, targetThreadId?: string) => {
    if (!activeStreamThreadId.value) return;
    if (targetThreadId && activeStreamThreadId.value === targetThreadId) return;

    console.log(
      `[StreamDebug][Renderer][ChatView] stop-stream reason=${reason} streamThread=${activeStreamThreadId.value} currentThread=${deps.getCurrentThreadId() || 'null'} targetThread=${targetThreadId || 'null'}`
    );

    try {
      await deps.electronAPI.chat.stopStream();
    } catch (error) {
      console.warn('[StreamDebug][Renderer][ChatView] stop-stream failed:', error);
    } finally {
      await resetTransientState();
    }
  };

  const beginTurn = (params: { threadId: string; parentId: string; tracePrefix?: string }) => {
    void dispatch({
      type: 'begin_turn',
      threadId: params.threadId,
      parentId: params.parentId,
      tracePrefix: params.tracePrefix,
    });
  };

  const handleUiChunk = async (chunk: unknown) => {
    if (!isStreamBoundToCurrentThread()) return;
    if (!isObjectRecord(chunk) || typeof chunk.type !== 'string') return;

    if (isMemoryRetrievalChunk(chunk)) {
      await dispatch({ type: 'memory_chunk', chunk });
      return;
    }

    if (chunk.type === 'text-delta') {
      const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
      if (!delta) return;
      await dispatch({ type: 'text_delta', delta });
      return;
    }

    if (chunk.type === 'finish' || chunk.type === 'abort') {
      await dispatch({ type: 'finalize_response', fullText: streamingAssistantText.value });
      return;
    }

    if (chunk.type === 'error') {
      const errorText =
        typeof chunk.errorText === 'string' && chunk.errorText.trim().length > 0
          ? chunk.errorText
          : 'Unknown chat stream error';
      console.error('[ChatView] UI stream error:', errorText);
      if (streamingAssistantText.value.trim().length > 0) {
        await dispatch({ type: 'finalize_response', fullText: streamingAssistantText.value });
      } else {
        await resetTransientState();
      }
      return;
    }

    const isToolChunk =
      chunk.type === 'tool-input-start' ||
      chunk.type === 'tool-input-delta' ||
      chunk.type === 'tool-input-available' ||
      chunk.type === 'tool-input-error' ||
      chunk.type === 'tool-output-available' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied' ||
      chunk.type === 'tool-approval-request';

    if (isToolChunk) {
      await dispatch({ type: 'tool_chunk', chunk: chunk as UIMessageChunk });
    }
  };

  const approvals = createToolApprovalMachine({
    electronAPI: deps.electronAPI as any,
    chat: deps.chat,
    createMessageId: deps.createMessageId,
    getCurrentThreadId: deps.getCurrentThreadId,
    isStreamBoundToCurrentThread,
    getOrCreateAssistantMessage,
    scrollToBottom: deps.scrollToBottom,
    activeStreamThreadId,
    activeAssistantMessageId,
    activeAssistantParentId,
    streamingAssistantText,
    streamRenderTraceId,
    streamRenderChunkCount,
    streamRenderChars,
    upsertUiMessage: deps.persistence.upsertUiMessage,
  });

  return {
    // state (used by the view for rendering keys / streaming markers)
    activeAssistantMessageId,
    streamRenderTick,

    // state (internal, but exported for orchestration convenience)
    activeAssistantParentId,
    activeStreamThreadId,

    // orchestration hooks
    beginTurn,
    handleUiChunk,
    isStreamBoundToCurrentThread,
    resetTransientState: resetTransientStateSync,
    stopActiveStreamIfNeeded,

    // approvals
    handleToolApproval: approvals.handleToolApproval,
    isApprovalProcessing: approvals.isApprovalProcessing,
  };
};
