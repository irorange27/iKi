import type { UIMessage, UIMessageChunk } from 'ai';
import { ref, type Ref } from 'vue';

import { isObjectRecord } from '../../../shared/utils/guards';
import { getApprovalId, getToolCallIdFromPart } from './ui_message_tool_parts';
import type { ChatMessageStore } from './chat_message_store';
import type { UiMessagePersistence } from './ui_message_persistence';
import {
  createInitialStreamState,
  reduceStream,
  type MessageOp,
  type StreamAction,
  type StreamEffect,
  type StreamState,
} from './ui_stream_reducer';
import {
  createToolApprovalService,
  type ApprovalEvent,
} from './tool_approval_service';
import {
  getToolUiState,
  getToolUiStateMap,
  updateToolUiState,
} from './tool_ui_state';

type ElectronAPI = {
  chat: {
    stopStream: () => Promise<unknown>;
    approveTool: (approvalId: string, approved: boolean) => Promise<{ success?: boolean; error?: string }>;
  };
};

const isMemoryRetrievalChunk = (
  chunk: Record<string, unknown>
): chunk is { type: 'memory-retrieval'; query?: unknown; results?: unknown } =>
  chunk.type === 'memory-retrieval';

export type ChatUiStreamController = ReturnType<typeof createChatUiStreamController>;

export const createChatUiStreamController = (deps: {
  messageStore: ChatMessageStore;
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

  const getAssistantMessageById = (id: string | null): UIMessage | undefined =>
    deps.messageStore.getById(id);

  const getOrCreateAssistantMessage = (): UIMessage => {
    const existing = getAssistantMessageById(activeAssistantMessageId.value);
    if (existing) return existing;

    const assistantMessage: UIMessage = {
      id: deps.createMessageId(),
      role: 'assistant',
      parts: [],
    };

    deps.messageStore.append(assistantMessage);
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
        deps.messageStore.append(op.message);
        continue;
      }

      const index = deps.messageStore.findIndexById(op.messageId);
      if (op.type === 'replace') {
        deps.messageStore.replaceAt(index, op.message);
        continue;
      }

      if (op.type === 'remove') {
        deps.messageStore.removeAt(index);
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
      if (effect.type === 'tool_ui_state') {
        updateToolUiState(effect.toolCallId, effect.patch);
        continue;
      }
      if (effect.type === 'notify_persisted') {
        if (!effect.shouldNotify) continue;
        const messagesSnapshot = deps.messageStore.snapshot();
        await Promise.resolve(
          deps.onAssistantMessagePersisted?.({
            threadId: effect.threadId,
            messagesSnapshot,
          })
        );
        continue;
      }
      if (effect.type === 'approval_request') {
        const approvalStartedAt = Date.now();
        if (effect.payload.toolCallId) {
          const uiState = getToolUiState(effect.payload.toolCallId);
          if (!uiState || typeof uiState.startedAt !== 'number' || !Number.isFinite(uiState.startedAt)) {
            updateToolUiState(effect.payload.toolCallId, { startedAt: approvalStartedAt });
          }
        }

        const assistantMessage = getOrCreateAssistantMessage();
        const approvalEvent: ApprovalEvent = {
          type: 'approval_requested',
          request: effect.payload,
          nowMs: approvalStartedAt,
        };
        const patch = approvals.applyApprovalEvent(assistantMessage, approvalEvent);
        if (patch.didChange) {
          deps.messageStore.upsert(patch.message);

          const threadId = activeStreamThreadId.value || deps.getCurrentThreadId() || '';
          if (threadId) {
            await deps.persistence.upsertUiMessage({
              message: patch.message,
              parentId: activeAssistantParentId.value || undefined,
              source: 'tool-approval-request',
              threadId,
            });
          }
        }

        deps.scrollToBottom();
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
      messages: deps.messageStore.messages,
      createMessageId: deps.createMessageId,
      currentThreadId: deps.getCurrentThreadId(),
      nowMs: Date.now(),
      toolUiStateMap: getToolUiStateMap(),
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

  const approvals = createToolApprovalService({
    createMessageId: deps.createMessageId,
  });

  const handleToolApproval = async (
    message: UIMessage,
    part: any,
    approved: boolean
  ): Promise<void> => {
    const approvalId = getApprovalId(part);
    if (!approvalId) return;
    const toolCallId = getToolCallIdFromPart(part);

    // After a reload, transient streaming state is empty, so UI chunks from a resumed approval would be ignored.
    // Re-bind the stream to the current thread + assistant message so resume works reliably.
    const currentThreadId = deps.getCurrentThreadId();
    if (currentThreadId) {
      activeStreamThreadId.value = currentThreadId;
    }
    if (message?.id) {
      activeAssistantMessageId.value = message.id;
    }
    if (!activeAssistantParentId.value && message?.id) {
      const messageIndex = deps.messageStore.findIndexById(message.id);
      if (messageIndex >= 0) {
        const parent = deps.messageStore.findLatestUserBefore(messageIndex);
        if (isObjectRecord(parent) && typeof parent.id === 'string') {
          activeAssistantParentId.value = parent.id;
        }
      }
    }
    streamingAssistantText.value = '';
    streamRenderTraceId.value = `approval-${Date.now()}`;
    streamRenderChunkCount.value = 0;
    streamRenderChars.value = 0;

    approvals.setApprovalProcessing(approvalId, true);

    try {
      const result = await deps.electronAPI.chat.approveTool(approvalId, approved);
      if (!result?.success) {
        throw new Error(result?.error || 'Tool approval failed');
      }

      const nowMs = Date.now();
      const event: ApprovalEvent = approved
        ? {
            type: 'approval_approved',
            approvalId,
            approved: true,
            reason: 'User approved tool execution.',
            nowMs,
          }
        : {
            type: 'approval_rejected',
            approvalId,
            approved: false,
            reason: 'User rejected tool execution.',
            nowMs,
          };

      const patch = approvals.applyApprovalEvent(message, event);
      if (patch.didChange) {
        deps.messageStore.upsert(patch.message);

        const threadId = activeStreamThreadId.value || deps.getCurrentThreadId() || '';
        if (threadId) {
          await deps.persistence.upsertUiMessage({
            message: patch.message,
            parentId: activeAssistantParentId.value || undefined,
            source: approved ? 'tool-approval:approve' : 'tool-approval:reject',
            threadId,
          });
        }
      }

      if (!approved && toolCallId) {
        const uiState = getToolUiState(toolCallId);
        const startedAt =
          typeof uiState?.startedAt === 'number' && Number.isFinite(uiState.startedAt)
            ? uiState.startedAt
            : nowMs;
        updateToolUiState(toolCallId, {
          startedAt,
          endedAt: nowMs,
          durationMs: Math.max(0, nowMs - startedAt),
        });
      }
    } catch (error) {
      console.error('Failed to approve tool:', error);
    } finally {
      approvals.setApprovalProcessing(approvalId, false);
    }
  };

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
    handleToolApproval,
    isApprovalProcessing: approvals.isApprovalProcessing,
  };
};
