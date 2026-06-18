import { ref } from 'vue';

import type {
  ChatUiMessage,
  ChatUiMessageChunk,
} from '@iki/core/chat/message_parts';
import type { ElectronApi } from '@iki/core/types/electron_api';
import { isObjectRecord } from '@iki/core/utils/guards';
import { createLogger } from '../../logger';
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
import { createToolApprovalService, type ApprovalEvent } from './tool_approval_service';
import { getToolUiState, getToolUiStateMap, updateToolUiState } from './tool_ui_state';

const streamControllerLogger = createLogger({ module: 'ui_stream_controller' });

const isMemoryRetrievalChunk = (
  chunk: Record<string, unknown>
): chunk is Extract<ChatUiMessageChunk, { type: 'data-memory-retrieval' }> =>
  chunk.type === 'data-memory-retrieval' && isObjectRecord(chunk.data);

const isSkillUsageChunk = (
  chunk: Record<string, unknown>
): chunk is Extract<ChatUiMessageChunk, { type: 'data-skill-usage' }> =>
  chunk.type === 'data-skill-usage' && isObjectRecord(chunk.data);

const isAffectSignalChunk = (
  chunk: Record<string, unknown>
): chunk is Extract<ChatUiMessageChunk, { type: 'data-affect-signal' }> =>
  chunk.type === 'data-affect-signal' && isObjectRecord(chunk.data);

const isTokenUsageChunk = (
  chunk: Record<string, unknown>
): chunk is Extract<ChatUiMessageChunk, { type: 'data-token-usage' }> =>
  chunk.type === 'data-token-usage' && isObjectRecord(chunk.data);

const isToolChunk = (
  chunk: Record<string, unknown>
): chunk is Extract<
  ChatUiMessageChunk,
  {
    type:
      | 'tool-input-start'
      | 'tool-input-delta'
      | 'tool-input-available'
      | 'tool-input-error'
      | 'tool-output-available'
      | 'tool-output-error'
      | 'tool-output-denied'
      | 'tool-approval-request';
  }
> =>
  chunk.type === 'tool-input-start' ||
  chunk.type === 'tool-input-delta' ||
  chunk.type === 'tool-input-available' ||
  chunk.type === 'tool-input-error' ||
  chunk.type === 'tool-output-available' ||
  chunk.type === 'tool-output-error' ||
  chunk.type === 'tool-output-denied' ||
  chunk.type === 'tool-approval-request';

export type ChatUiStreamController = ReturnType<typeof createChatUiStreamController>;

export const createChatUiStreamController = (deps: {
  messageStore: ChatMessageStore;
  electronAPI: Pick<ElectronApi, 'chat'>;
  persistence: UiMessagePersistence;
  createMessageId: () => string;
  scrollToBottom: () => void;
  getCurrentThreadId: () => string | null;
  onAssistantMessagePersisted?: (params: {
    threadId: string;
    messagesSnapshot: ChatUiMessage[];
  }) => Promise<void> | void;
}) => {
  const initialState = createInitialStreamState();
  const activeAssistantMessageId = ref<string | null>(initialState.activeAssistantMessageId);
  const activeAssistantParentId = ref<string | null>(initialState.activeAssistantParentId);
  const activeStreamThreadId = ref<string | null>(initialState.activeStreamThreadId);
  const streamingAssistantText = ref(initialState.streamingAssistantText);
  const streamRenderTick = ref(initialState.streamRenderTick);
  const mainMessageId = ref<string | null>(null);

  const getAssistantMessageById = (id: string | null): ChatUiMessage | undefined =>
    deps.messageStore.getById(id);

  const getOrCreateAssistantMessage = (): ChatUiMessage => {
    const existing = getAssistantMessageById(activeAssistantMessageId.value);
    if (existing) return existing;

    const assistantMessage: ChatUiMessage = {
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
  });

  const commitStateToRefs = (state: StreamState) => {
    activeAssistantMessageId.value = state.activeAssistantMessageId;
    activeAssistantParentId.value = state.activeAssistantParentId;
    activeStreamThreadId.value = state.activeStreamThreadId;
    streamingAssistantText.value = state.streamingAssistantText;
    streamRenderTick.value = state.streamRenderTick;
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
          if (
            !uiState ||
            typeof uiState.startedAt !== 'number' ||
            !Number.isFinite(uiState.startedAt)
          ) {
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

  let dispatchQueue: Promise<void> = Promise.resolve();

  const dispatch = (action: StreamAction): Promise<void> => {
    const task = dispatchQueue.then(async () => {
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
    });
    dispatchQueue = task.catch(() => {
      // Intentional: suppress unhandled rejection for fire-and-forget dispatch
    });
    return task;
  };

  const resetTransientState = async () => {
    mainMessageId.value = null;
    await dispatch({ type: 'reset' });
  };

  const resetTransientStateSync = (): void => {
    void resetTransientState();
  };

  const stopActiveStreamIfNeeded = async (targetThreadId?: string) => {
    if (!activeStreamThreadId.value) return;
    if (targetThreadId && activeStreamThreadId.value === targetThreadId) return;

    try {
      await deps.electronAPI.chat.stopStream();
    } catch (error) {
      streamControllerLogger.event({
        level: 'warn',
        event: 'chat.stream.stop',
        outcome: 'failed',
        error,
      });
    } finally {
      await resetTransientState();
    }
  };

  const beginTurn = (params: { threadId: string; parentId: string }) => {
    mainMessageId.value = null;
    dispatch({
      type: 'begin_turn',
      threadId: params.threadId,
      parentId: params.parentId,
    }).catch((error: unknown) => {
      streamControllerLogger.event({
        level: 'warn',
        event: 'chat.stream.begin_turn',
        outcome: 'failed',
        error,
      });
    });
  };

  const handleUiChunk = async (chunk: unknown) => {
    if (!isStreamBoundToCurrentThread()) return;
    if (!isObjectRecord(chunk) || typeof chunk.type !== 'string') return;

    if (isMemoryRetrievalChunk(chunk)) {
      await dispatch({ type: 'memory_chunk', chunk: chunk.data });
      return;
    }

    if (isSkillUsageChunk(chunk)) {
      await dispatch({ type: 'skill_chunk', chunk: chunk.data });
      return;
    }

    if (isAffectSignalChunk(chunk)) {
      await dispatch({ type: 'affect_chunk', chunk: chunk.data });
      return;
    }

    if (isTokenUsageChunk(chunk)) {
      await dispatch({ type: 'usage_chunk', chunk: chunk.data });
      return;
    }

    if (chunk.type === 'start') {
      const startMessageId = (chunk as { messageId?: string }).messageId;
      if (typeof startMessageId === 'string') {
        mainMessageId.value = startMessageId;
      }
      return;
    }

    if (chunk.type === 'text-start' || chunk.type === 'text-end') {
      return;
    }

    if (chunk.type === 'text-delta') {
      const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
      if (!delta) return;
      await dispatch({ type: 'text_delta', delta });
      return;
    }

    if (chunk.type === 'finish' || chunk.type === 'abort') {
      // Ignore stale finalization from a superseded stream
      const chunkMessageId = (chunk as { messageId?: string }).messageId;
      if (
        chunkMessageId &&
        mainMessageId.value &&
        chunkMessageId !== mainMessageId.value
      ) {
        return;
      }
      await dispatch({ type: 'finalize_response', fullText: streamingAssistantText.value });
      return;
    }

    if (chunk.type === 'error') {
      const errorText =
        typeof chunk.errorText === 'string' && chunk.errorText.trim().length > 0
          ? chunk.errorText
          : 'Unknown chat stream error';
      streamControllerLogger.event({
        level: 'error',
        event: 'chat.stream',
        outcome: 'failed',
        message: errorText,
      });
      if (streamingAssistantText.value.trim().length > 0) {
        await dispatch({ type: 'finalize_response', fullText: streamingAssistantText.value });
      } else {
        await resetTransientState();
      }
      return;
    }

    if (isToolChunk(chunk)) {
      await dispatch({ type: 'tool_chunk', chunk });
      return;
    }

    streamControllerLogger.event({
      level: 'warn',
      event: 'chat.stream.unknown_chunk',
      message: `Unrecognized chunk type: ${String(chunk.type)}`,
    });
  };

  const approvals = createToolApprovalService({
    createMessageId: deps.createMessageId,
  });

  const handleToolApproval = async (
    message: ChatUiMessage,
    part: unknown,
    approved: boolean
  ): Promise<void> => {
    const approvalId = getApprovalId(part);
    if (!approvalId) return;
    const toolCallId = getToolCallIdFromPart(part);

    // After a reload, transient streaming state is empty, so UI chunks from a resumed approval would be ignored.
    // Re-bind the stream to the current thread + assistant message so resume works reliably.
    // Only rebind when recovering from a reload (activeStreamThreadId is null); keep existing binding
    // during normal operation to avoid silently dropping chunks after thread switches.
    const currentThreadId = deps.getCurrentThreadId();
    if (!activeStreamThreadId.value && currentThreadId) {
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

      const latestMessage = deps.messageStore.getById(message.id) || message;
      const patch = approvals.applyApprovalEvent(latestMessage, event);
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
      streamControllerLogger.event({
        level: 'error',
        event: 'chat.tool_approval',
        outcome: 'failed',
        error,
      });
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
