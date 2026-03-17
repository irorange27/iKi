import type { UIMessage, UIMessageChunk } from 'ai';
import { ref, type Ref } from 'vue';

import {
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  parseToolInputFromText,
} from './ui_message_tool_parts';
import type { UiMessagePersistence } from './ui_message_persistence';
import { createToolApprovalMachine } from './tool_approval_machine';

type ElectronAPI = {
  chat: {
    stopStream: () => Promise<unknown>;
    approveTool: (approvalId: string, approved: boolean) => Promise<{ success?: boolean; error?: string }>;
  };
};

type MessagePartRecord = Record<string, any> & { type: string };

const shouldLogStreamChunk = (count: number) => count <= 3 || count % 20 === 0;

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
  const activeAssistantMessageId = ref<string | null>(null);
  const activeAssistantParentId = ref<string | null>(null);
  const activeStreamThreadId = ref<string | null>(null);
  const streamingAssistantText = ref('');
  const streamRenderTick = ref(0);
  const streamRenderTraceId = ref('');
  const streamRenderChunkCount = ref(0);
  const streamRenderChars = ref(0);

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

  const resetTransientState = () => {
    activeAssistantMessageId.value = null;
    activeAssistantParentId.value = null;
    activeStreamThreadId.value = null;
    streamingAssistantText.value = '';
    streamRenderTraceId.value = '';
    streamRenderChunkCount.value = 0;
    streamRenderChars.value = 0;
    approvals.resetApprovalProcessing();
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
      resetTransientState();
    }
  };

  const beginTurn = (params: { threadId: string; parentId: string; tracePrefix?: string }) => {
    activeAssistantParentId.value = params.parentId;
    activeAssistantMessageId.value = null;
    activeStreamThreadId.value = params.threadId;
    streamingAssistantText.value = '';
    streamRenderTraceId.value = `${params.tracePrefix || 'view'}-${Date.now()}`;
    streamRenderChunkCount.value = 0;
    streamRenderChars.value = 0;
    approvals.resetApprovalProcessing();
  };

  const handleStreamChunk = (chunk: string) => {
    if (!isStreamBoundToCurrentThread()) return;

    streamRenderTick.value += 1;
    streamingAssistantText.value += chunk;
    if (!streamRenderTraceId.value) {
      streamRenderTraceId.value = `view-${Date.now()}`;
    }
    streamRenderChunkCount.value += 1;
    streamRenderChars.value += chunk.length;
    if (shouldLogStreamChunk(streamRenderChunkCount.value)) {
      console.log(
        `[StreamDebug][Renderer][ChatView][${streamRenderTraceId.value}] handleStreamChunk#${streamRenderChunkCount.value} len=${chunk.length} totalChars=${streamRenderChars.value}`
      );
    }

    const assistantMessage = getOrCreateAssistantMessage();
    const messageIndex = deps.chat.messages.findIndex((message: any) => message.id === assistantMessage.id);
    if (messageIndex < 0) return;

    const currentMessage = deps.chat.messages[messageIndex] as UIMessage;
    const nextParts = [...currentMessage.parts];
    const lastPart = nextParts[nextParts.length - 1];
    const shouldAppendToLastStreamingText =
      isObjectRecord(lastPart) && lastPart.type === 'text' && lastPart.state === 'streaming';

    if (shouldAppendToLastStreamingText) {
      const textPartIndex = nextParts.length - 1;
      const textPart = nextParts[textPartIndex] as Record<string, unknown>;
      const previousText = typeof textPart.text === 'string' ? textPart.text : '';
      nextParts[textPartIndex] = {
        ...textPart,
        text: `${previousText}${chunk}`,
        state: 'streaming',
      } as any;
    } else {
      nextParts.push({
        type: 'text',
        text: chunk,
        state: 'streaming',
      } as any);
    }

    deps.chat.messages.splice(
      messageIndex,
      1,
      {
        ...currentMessage,
        parts: nextParts,
      } as any
    );

    deps.scrollToBottom();
  };

  const handleResponseReceived = async (fullText: string) => {
    if (!isStreamBoundToCurrentThread()) return;

    streamRenderTick.value += 1;
    const responseThreadId = activeStreamThreadId.value || deps.getCurrentThreadId() || '';
    if (!responseThreadId) return;

    const assistantMessageId = activeAssistantMessageId.value;
    const existingAssistantMessage = getAssistantMessageById(assistantMessageId);
    if (!existingAssistantMessage && !fullText.trim()) {
      resetTransientState();
      return;
    }

    const baseAssistantMessage = existingAssistantMessage || getOrCreateAssistantMessage();
    const messageIndex = deps.chat.messages.findIndex(
      (message: any) => message.id === baseAssistantMessage.id
    );
    if (messageIndex < 0) {
      resetTransientState();
      return;
    }

    const currentAssistantMessage = deps.chat.messages[messageIndex] as UIMessage;
    const nextParts = [...currentAssistantMessage.parts];
    const textPartIndices = nextParts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => isObjectRecord(part) && part.type === 'text')
      .map(({ index }) => index);
    const existingTextPart =
      textPartIndices.length > 0
        ? (nextParts[textPartIndices[textPartIndices.length - 1]] as Record<string, unknown>)
        : undefined;
    const streamedText =
      existingTextPart && typeof existingTextPart.text === 'string' ? existingTextPart.text : '';
    const finalText = fullText.length > 0 ? fullText : streamingAssistantText.value || streamedText;
    let hasStreamingTextPart = false;

    for (const index of textPartIndices) {
      const part = nextParts[index] as Record<string, unknown>;
      if (part.state === 'streaming') {
        hasStreamingTextPart = true;
        nextParts[index] = {
          ...part,
          type: 'text',
          state: 'done',
        } as any;
      }
    }

    if (textPartIndices.length === 0 && finalText) {
      nextParts.push({
        type: 'text',
        text: finalText,
        state: 'done',
      } as any);
    } else if (!hasStreamingTextPart && finalText && !streamedText) {
      nextParts.push({
        type: 'text',
        text: finalText,
        state: 'done',
      } as any);
    }

    const assistantMessage: UIMessage = {
      ...currentAssistantMessage,
      parts: nextParts,
    };

    const hasRenderableContent = assistantMessage.parts.some(part => {
      if (isObjectRecord(part) && part.type === 'text') {
        return typeof part.text === 'string' && part.text.trim().length > 0;
      }
      return true;
    });

    if (!hasRenderableContent) {
      const messageIndex = deps.chat.messages.findIndex((message: any) => message.id === assistantMessage.id);
      if (messageIndex >= 0) {
        deps.chat.messages.splice(messageIndex, 1);
      }
      resetTransientState();
      deps.scrollToBottom();
      return;
    }

    deps.chat.messages.splice(messageIndex, 1, assistantMessage as any);
    const messagesSnapshotForTitle = [...(deps.chat.messages as UIMessage[])];
    console.log(
      `[StreamDebug][Renderer][ChatView][${streamRenderTraceId.value || 'unknown'}] handleResponseReceived fullTextLen=${(fullText || '').length} chunkCount=${streamRenderChunkCount.value} chunkChars=${streamRenderChars.value}`
    );

    await deps.persistence.upsertUiMessage({
      message: assistantMessage,
      parentId: activeAssistantParentId.value || undefined,
      source: 'assistant-response',
      threadId: responseThreadId,
    });

    if (deps.getCurrentThreadId() === responseThreadId) {
      await Promise.resolve(
        deps.onAssistantMessagePersisted?.({
          threadId: responseThreadId,
          messagesSnapshot: messagesSnapshotForTitle,
        })
      );
    }

    resetTransientState();
    deps.scrollToBottom();
  };

  const handleToolUiChunk = async (chunk: UIMessageChunk) => {
    if (
      chunk.type !== 'tool-input-start' &&
      chunk.type !== 'tool-input-delta' &&
      chunk.type !== 'tool-input-available' &&
      chunk.type !== 'tool-input-error' &&
      chunk.type !== 'tool-output-available' &&
      chunk.type !== 'tool-output-error' &&
      chunk.type !== 'tool-output-denied' &&
      chunk.type !== 'tool-approval-request'
    ) {
      return;
    }

    if (chunk.type === 'tool-approval-request') {
      const existingAssistantMessage = getAssistantMessageById(activeAssistantMessageId.value);
      const existingPart = existingAssistantMessage?.parts.find(
        part => getToolCallIdFromPart(part) === chunk.toolCallId
      );
      const existingToolName = getToolName(existingPart);
      const existingInput = getToolInput(existingPart) ?? {};

      await approvals.handleToolApprovalRequest({
        approvalId: chunk.approvalId,
        toolCallId: chunk.toolCallId,
        toolCall: {
          toolName: existingToolName,
          toolCallId: chunk.toolCallId,
          args: existingInput,
        },
      });
      return;
    }

    const assistantMessage = getOrCreateAssistantMessage();
    const messageIndex = deps.chat.messages.findIndex((message: any) => message.id === assistantMessage.id);
    if (messageIndex < 0) return;

    const currentAssistantMessage = deps.chat.messages[messageIndex] as UIMessage;
    const nextParts = [...currentAssistantMessage.parts];
    for (let i = 0; i < nextParts.length; i += 1) {
      const part = nextParts[i];
      if (!isObjectRecord(part) || part.type !== 'text' || part.state !== 'streaming') continue;
      nextParts[i] = {
        ...part,
        state: 'done',
      } as any;
    }

    const toolCallId = chunk.toolCallId;
    const existingPartIndex = nextParts.findIndex(part => getToolCallIdFromPart(part) === toolCallId);
    const existingPart =
      existingPartIndex >= 0 && isObjectRecord(nextParts[existingPartIndex])
        ? (nextParts[existingPartIndex] as MessagePartRecord)
        : undefined;
    const chunkToolName =
      'toolName' in chunk && typeof chunk.toolName === 'string' && chunk.toolName.trim()
        ? chunk.toolName
        : undefined;

    const nextPart: MessagePartRecord = {
      ...(existingPart || {}),
      type: 'dynamic-tool',
      toolCallId,
      toolName:
        chunkToolName ||
        (existingPart && typeof existingPart.toolName === 'string' ? existingPart.toolName : 'tool'),
    };

    const nowMs = Date.now();
    if (typeof nextPart.startedAt !== 'number' || !Number.isFinite(nextPart.startedAt)) {
      nextPart.startedAt = nowMs;
    }

    if ('providerExecuted' in chunk && typeof chunk.providerExecuted === 'boolean') {
      nextPart.providerExecuted = chunk.providerExecuted;
    }
    if ('title' in chunk && typeof chunk.title === 'string') {
      nextPart.title = chunk.title;
    }

    if (chunk.type === 'tool-input-start') {
      nextPart.state = 'input-streaming';
      if (nextPart.input === undefined) {
        nextPart.input = {};
      }
    } else if (chunk.type === 'tool-input-delta') {
      const delta = typeof chunk.inputTextDelta === 'string' ? chunk.inputTextDelta : '';
      const previousInputText = typeof nextPart.inputText === 'string' ? nextPart.inputText : '';
      const inputText = `${previousInputText}${delta}`;
      nextPart.inputText = inputText;
      nextPart.input = parseToolInputFromText(inputText);
      nextPart.state = 'input-streaming';
    } else if (chunk.type === 'tool-input-available') {
      if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
        // Preserve any fields that may have been present in streamed JSON but stripped by tool schema validation.
        nextPart.input = { ...nextPart.input, ...chunk.input };
      } else {
        nextPart.input = chunk.input ?? nextPart.input ?? {};
      }
      nextPart.state = 'input-available';
      delete nextPart.inputText;
    } else if (chunk.type === 'tool-input-error') {
      if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
        nextPart.input = { ...nextPart.input, ...chunk.input };
      } else {
        nextPart.input = chunk.input ?? nextPart.input ?? {};
      }
      nextPart.output = {
        error: chunk.errorText || 'Invalid tool input',
      };
      nextPart.state = 'output-error';
      nextPart.endedAt = nowMs;
      nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
      delete nextPart.inputText;
    } else if (chunk.type === 'tool-output-available') {
      nextPart.output = chunk.output;
      nextPart.state = chunk.preliminary ? 'input-streaming' : 'output-available';
      if (!chunk.preliminary) {
        nextPart.endedAt = nowMs;
        nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
        if (typeof nextPart.collapsed !== 'boolean') {
          nextPart.collapsed = true;
        }
      }
      delete nextPart.inputText;
    } else if (chunk.type === 'tool-output-error') {
      nextPart.output = {
        error: chunk.errorText || 'Tool execution failed',
      };
      nextPart.state = 'output-error';
      nextPart.endedAt = nowMs;
      nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
      delete nextPart.inputText;
    } else if (chunk.type === 'tool-output-denied') {
      nextPart.state = 'output-denied';
      nextPart.output = {
        message: 'Tool execution denied',
        toolCallId,
      };
      nextPart.endedAt = nowMs;
      nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
      delete nextPart.inputText;
    }

    if (existingPartIndex >= 0) {
      nextParts[existingPartIndex] = nextPart as any;
    } else {
      nextParts.push(nextPart as any);
    }

    const updatedMessage: UIMessage = {
      ...currentAssistantMessage,
      parts: nextParts,
    };

    deps.chat.messages.splice(messageIndex, 1, updatedMessage as any);

    if (
      chunk.type === 'tool-input-available' ||
      chunk.type === 'tool-input-error' ||
      chunk.type === 'tool-output-available' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied'
    ) {
      const streamThreadId = activeStreamThreadId.value || deps.getCurrentThreadId() || '';
      if (streamThreadId) {
        await deps.persistence.upsertUiMessage({
          message: updatedMessage,
          parentId: activeAssistantParentId.value || undefined,
          source: `tool-ui-chunk:${chunk.type}`,
          threadId: streamThreadId,
        });
      }
    }

    deps.scrollToBottom();
  };

  const handleMemoryRetrievalChunk = async (chunk: { query?: unknown; results?: unknown }) => {
    if (!isStreamBoundToCurrentThread()) return;

    const results = Array.isArray(chunk.results)
      ? chunk.results.filter(entry => isObjectRecord(entry) && typeof entry.summary === 'string')
      : [];

    const assistantMessage = getOrCreateAssistantMessage();
    const messageIndex = deps.chat.messages.findIndex(
      (message: any) => message.id === assistantMessage.id
    );
    if (messageIndex < 0) return;

    const currentAssistantMessage = deps.chat.messages[messageIndex] as UIMessage;
    const nextParts = [...currentAssistantMessage.parts];
    const existingIndex = nextParts.findIndex(
      part => isObjectRecord(part) && part.type === 'memory-retrieval'
    );

    if (results.length === 0) {
      if (existingIndex >= 0) {
        nextParts.splice(existingIndex, 1);
        deps.chat.messages.splice(messageIndex, 1, {
          ...currentAssistantMessage,
          parts: nextParts,
        } as any);
      }
      return;
    }

    const memoryPart: MessagePartRecord = {
      type: 'memory-retrieval',
      query: typeof chunk.query === 'string' ? chunk.query : '',
      results,
    };

    if (existingIndex >= 0) {
      nextParts[existingIndex] = memoryPart;
    } else {
      nextParts.unshift(memoryPart);
    }

    const updatedMessage: UIMessage = {
      ...currentAssistantMessage,
      parts: nextParts,
    };

    deps.chat.messages.splice(messageIndex, 1, updatedMessage as any);
    deps.scrollToBottom();
  };

  const handleUiChunk = async (chunk: unknown) => {
    if (!isStreamBoundToCurrentThread()) return;
    if (!isObjectRecord(chunk) || typeof chunk.type !== 'string') return;

    if (isMemoryRetrievalChunk(chunk)) {
      await handleMemoryRetrievalChunk(chunk);
      return;
    }

    if (chunk.type === 'text-delta') {
      const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
      if (!delta) return;
      handleStreamChunk(delta);
      return;
    }

    if (chunk.type === 'finish' || chunk.type === 'abort') {
      await handleResponseReceived(streamingAssistantText.value);
      return;
    }

    if (chunk.type === 'error') {
      const errorText =
        typeof chunk.errorText === 'string' && chunk.errorText.trim().length > 0
          ? chunk.errorText
          : 'Unknown chat stream error';
      console.error('[ChatView] UI stream error:', errorText);
      if (streamingAssistantText.value.trim().length > 0) {
        await handleResponseReceived(streamingAssistantText.value);
      } else {
        resetTransientState();
      }
      return;
    }

    await handleToolUiChunk(chunk as UIMessageChunk);
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
    resetTransientState,
    stopActiveStreamIfNeeded,

    // approvals
    handleToolApproval: approvals.handleToolApproval,
    isApprovalProcessing: approvals.isApprovalProcessing,
  };
};
