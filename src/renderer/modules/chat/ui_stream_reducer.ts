import type { UIMessage, UIMessageChunk } from 'ai';

import {
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  parseToolInputFromText,
} from './ui_message_tool_parts';
import type { ToolUiState, ToolUiStatePatch } from './tool_ui_state';
import {
  isDynamicToolPart,
  isMemoryPart,
  isObjectRecord,
  isTextPart,
  type DynamicToolPart,
  type MemoryPart,
  type TextPart,
  type UiMessagePart,
} from '../../../shared/chat/message_parts';

export type StreamState = {
  activeAssistantMessageId: string | null;
  activeAssistantParentId: string | null;
  activeStreamThreadId: string | null;
  streamingAssistantText: string;
  streamRenderTick: number;
};

export const createInitialStreamState = (): StreamState => ({
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
  streamRenderTick: 0,
});

export type StreamContext = {
  messages: UIMessage[];
  createMessageId: () => string;
  currentThreadId: string | null;
  nowMs: number;
  toolUiStateMap: Readonly<Record<string, ToolUiState>>;
};

export type MessageOp =
  | { type: 'append'; message: UIMessage }
  | { type: 'replace'; messageId: string; message: UIMessage }
  | { type: 'remove'; messageId: string };

export type StreamEffect =
  | { type: 'scroll' }
  | {
      type: 'persist';
      message: UIMessage;
      threadId: string;
      parentId?: string;
      source: string;
    }
  | { type: 'notify_persisted'; threadId: string; shouldNotify: boolean }
  | { type: 'tool_ui_state'; toolCallId: string; patch: ToolUiStatePatch }
  | {
      type: 'approval_request';
      payload: {
        approvalId: string;
        toolCallId: string;
        toolCall: { toolName: string; toolCallId: string; args: unknown };
      };
    }
  | { type: 'reset_approvals' };

export type StreamAction =
  | { type: 'begin_turn'; threadId: string; parentId: string }
  | { type: 'reset' }
  | { type: 'text_delta'; delta: string }
  | { type: 'finalize_response'; fullText: string }
  | { type: 'tool_chunk'; chunk: UIMessageChunk }
  | { type: 'memory_chunk'; chunk: { query?: unknown; results?: unknown } };

export type ReduceResult = {
  state: StreamState;
  messageOps: MessageOp[];
  effects: StreamEffect[];
};

const resetTransientState = (state: StreamState): StreamState => ({
  ...state,
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
});

const updateAssistantMessage = (
  state: StreamState,
  ctx: StreamContext,
  build: (message: UIMessage) => UIMessage | null
): { state: StreamState; messageOps: MessageOp[]; updatedMessage?: UIMessage } => {
  const messageId = state.activeAssistantMessageId;
  const existingIndex = messageId
    ? ctx.messages.findIndex(message => message.id === messageId)
    : -1;

  let baseMessage: UIMessage;
  let nextState = state;
  const existed = existingIndex >= 0;

  if (existed) {
    baseMessage = ctx.messages[existingIndex] as UIMessage;
  } else {
    baseMessage = {
      id: ctx.createMessageId(),
      role: 'assistant',
      parts: [],
    };
    nextState = {
      ...state,
      activeAssistantMessageId: baseMessage.id,
    };
  }

  const updated = build(baseMessage);
  const messageOps: MessageOp[] = [];

  if (updated) {
    messageOps.push({
      type: existed ? 'replace' : 'append',
      messageId: updated.id,
      message: updated,
    });
  } else if (existed) {
    messageOps.push({
      type: 'remove',
      messageId: baseMessage.id,
    });
  }

  return { state: nextState, messageOps, updatedMessage: updated ?? undefined };
};

const buildStreamingTextParts = (parts: UiMessagePart[], delta: string): UiMessagePart[] => {
  const nextParts = [...parts];
  const lastPart = nextParts[nextParts.length - 1];
  const shouldAppendToLast = isTextPart(lastPart) && lastPart.state === 'streaming';

  if (shouldAppendToLast) {
    const textPartIndex = nextParts.length - 1;
    const textPart = nextParts[textPartIndex] as TextPart;
    const previousText = textPart.text || '';
    nextParts[textPartIndex] = {
      ...textPart,
      text: `${previousText}${delta}`,
      state: 'streaming',
    };
  } else {
    const newPart: TextPart = {
      type: 'text',
      text: delta,
      state: 'streaming',
    };
    nextParts.push(newPart);
  }

  return nextParts;
};

const finalizeTextParts = (
  parts: UiMessagePart[],
  fullText: string,
  streamedText: string
): { parts: UiMessagePart[]; hasStreamingTextPart: boolean; appendedText?: string } => {
  const nextParts = [...parts];
  const textPartIndices = nextParts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => isTextPart(part))
    .map(({ index }) => index);

  const existingTextPart =
    textPartIndices.length > 0
      ? (nextParts[textPartIndices[textPartIndices.length - 1]] as TextPart)
      : undefined;
  const existingStreamed = existingTextPart ? existingTextPart.text : '';

  const finalText = fullText.length > 0 ? fullText : streamedText || existingStreamed;
  let hasStreamingTextPart = false;

  for (const index of textPartIndices) {
    const part = nextParts[index] as TextPart;
    if (part.state === 'streaming') {
      hasStreamingTextPart = true;
      nextParts[index] = {
        ...part,
        state: 'done',
      };
    }
  }

  if (textPartIndices.length === 0 && finalText) {
    const newPart: TextPart = {
      type: 'text',
      text: finalText,
      state: 'done',
    };
    nextParts.push(newPart);
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  if (!hasStreamingTextPart && finalText && !existingStreamed) {
    const newPart: TextPart = {
      type: 'text',
      text: finalText,
      state: 'done',
    };
    nextParts.push(newPart);
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  return { parts: nextParts, hasStreamingTextPart };
};

const hasRenderableContent = (parts: UiMessagePart[]): boolean =>
  parts.some(part => (isTextPart(part) ? part.text.trim().length > 0 : true));

const buildToolPartUpdate = (
  part: DynamicToolPart,
  chunk: UIMessageChunk,
  inputText?: string
): DynamicToolPart => {
  const nextPart = { ...part };

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
    return nextPart;
  }

  if (chunk.type === 'tool-input-delta') {
    const nextInputText = typeof inputText === 'string' ? inputText : '';
    nextPart.input = parseToolInputFromText(nextInputText);
    nextPart.state = 'input-streaming';
    return nextPart;
  }

  if (chunk.type === 'tool-input-available') {
    if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
      nextPart.input = { ...nextPart.input, ...chunk.input };
    } else {
      nextPart.input = chunk.input ?? nextPart.input ?? {};
    }
    nextPart.state = 'input-available';
    return nextPart;
  }

  if (chunk.type === 'tool-input-error') {
    if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
      nextPart.input = { ...nextPart.input, ...chunk.input };
    } else {
      nextPart.input = chunk.input ?? nextPart.input ?? {};
    }
    nextPart.output = {
      error: chunk.errorText || 'Invalid tool input',
    };
    nextPart.state = 'output-error';
    return nextPart;
  }

  if (chunk.type === 'tool-output-available') {
    nextPart.output = chunk.output;
    nextPart.state = chunk.preliminary ? 'input-streaming' : 'output-available';
    return nextPart;
  }

  if (chunk.type === 'tool-output-error') {
    nextPart.output = {
      error: chunk.errorText || 'Tool execution failed',
    };
    nextPart.state = 'output-error';
    return nextPart;
  }

  if (chunk.type === 'tool-output-denied') {
    nextPart.state = 'output-denied';
    nextPart.output = {
      message: 'Tool execution denied',
      toolCallId: nextPart.toolCallId,
    };
    return nextPart;
  }

  return nextPart;
};

const buildToolUiStatePatch = (
  chunk: UIMessageChunk,
  nowMs: number,
  previousState: ToolUiState | undefined,
  nextInputText?: string
): ToolUiStatePatch => {
  const patch: ToolUiStatePatch = {};
  const startedAt =
    typeof previousState?.startedAt === 'number' && Number.isFinite(previousState.startedAt)
      ? previousState.startedAt
      : undefined;

  const ensureStartedAt = () => {
    if (startedAt === undefined && patch.startedAt === undefined) {
      patch.startedAt = nowMs;
    }
  };

  const finalizeDuration = () => {
    const resolvedStart = startedAt ?? nowMs;
    if (startedAt === undefined) {
      patch.startedAt = resolvedStart;
    }
    patch.endedAt = nowMs;
    patch.durationMs = Math.max(0, nowMs - resolvedStart);
  };

  const clearInputText = () => {
    if (previousState?.inputText !== undefined) {
      patch.inputText = undefined;
    }
  };

  if (chunk.type === 'tool-input-start') {
    ensureStartedAt();
    if (typeof previousState?.inputText !== 'string' || previousState.inputText.length > 0) {
      patch.inputText = '';
    }
    return patch;
  }

  if (chunk.type === 'tool-input-delta') {
    ensureStartedAt();
    patch.inputText = typeof nextInputText === 'string' ? nextInputText : '';
    return patch;
  }

  if (chunk.type === 'tool-input-available') {
    clearInputText();
    return patch;
  }

  if (chunk.type === 'tool-input-error') {
    finalizeDuration();
    clearInputText();
    return patch;
  }

  if (chunk.type === 'tool-output-available') {
    clearInputText();
    if (!chunk.preliminary) {
      finalizeDuration();
      if (typeof previousState?.collapsed !== 'boolean') {
        patch.collapsed = true;
      }
    }
    return patch;
  }

  if (chunk.type === 'tool-output-error') {
    finalizeDuration();
    clearInputText();
    return patch;
  }

  if (chunk.type === 'tool-output-denied') {
    finalizeDuration();
    clearInputText();
    return patch;
  }

  return patch;
};

export const reduceStream = (
  state: StreamState,
  ctx: StreamContext,
  action: StreamAction
): ReduceResult => {
  if (action.type === 'begin_turn') {
    const nextState: StreamState = {
      ...state,
      activeAssistantParentId: action.parentId,
      activeAssistantMessageId: null,
      activeStreamThreadId: action.threadId,
      streamingAssistantText: '',
    };

    return {
      state: nextState,
      messageOps: [],
      effects: [{ type: 'reset_approvals' }],
    };
  }

  if (action.type === 'reset') {
    return {
      state: resetTransientState(state),
      messageOps: [],
      effects: [{ type: 'reset_approvals' }],
    };
  }

  if (action.type === 'text_delta') {
    const nextState: StreamState = {
      ...state,
      streamRenderTick: state.streamRenderTick + 1,
      streamingAssistantText: `${state.streamingAssistantText}${action.delta}`,
    };

    const updateResult = updateAssistantMessage(nextState, ctx, message => {
      const nextParts = buildStreamingTextParts(message.parts as UiMessagePart[], action.delta);
      return {
        ...message,
        parts: nextParts as UIMessage['parts'],
      };
    });

    const effects: StreamEffect[] = [{ type: 'scroll' }];

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects,
    };
  }

  if (action.type === 'finalize_response') {
    const nextStateBase: StreamState = {
      ...state,
      streamRenderTick: state.streamRenderTick + 1,
    };
    const responseThreadId = state.activeStreamThreadId || ctx.currentThreadId || '';
    if (!responseThreadId) {
      return {
        state: nextStateBase,
        messageOps: [],
        effects: [],
      };
    }

    const existingIndex = state.activeAssistantMessageId
      ? ctx.messages.findIndex(message => message.id === state.activeAssistantMessageId)
      : -1;

    if (existingIndex < 0 && !action.fullText.trim()) {
      return {
        state: resetTransientState(nextStateBase),
        messageOps: [],
        effects: [{ type: 'reset_approvals' }],
      };
    }

    const updateResult = updateAssistantMessage(nextStateBase, ctx, message => {
      const streamedText = state.streamingAssistantText;
      const finalizeResult = finalizeTextParts(
        message.parts as UiMessagePart[],
        action.fullText,
        streamedText
      );

      const updatedMessage: UIMessage = {
        ...message,
        parts: finalizeResult.parts as UIMessage['parts'],
      };

      if (!hasRenderableContent(updatedMessage.parts as UiMessagePart[])) {
        return null;
      }

      return updatedMessage;
    });

    const updatedMessage = updateResult.updatedMessage;
    if (!updatedMessage) {
      return {
        state: resetTransientState(updateResult.state),
        messageOps: updateResult.messageOps,
        effects: [{ type: 'reset_approvals' }, { type: 'scroll' }],
      };
    }

    const effects: StreamEffect[] = [
      {
        type: 'persist',
        message: updatedMessage,
        parentId: updateResult.state.activeAssistantParentId || undefined,
        source: 'assistant-response',
        threadId: responseThreadId,
      },
      {
        type: 'notify_persisted',
        threadId: responseThreadId,
        shouldNotify: ctx.currentThreadId === responseThreadId,
      },
      { type: 'reset_approvals' },
      { type: 'scroll' },
    ];

    return {
      state: resetTransientState(updateResult.state),
      messageOps: updateResult.messageOps,
      effects,
    };
  }

  if (action.type === 'tool_chunk') {
    const chunk = action.chunk as UIMessageChunk & { toolCallId: string };
    if (chunk.type === 'tool-approval-request') {
      const approvalChunk = chunk as UIMessageChunk & { toolCallId: string; approvalId: string };
      const existingMessage = state.activeAssistantMessageId
        ? ctx.messages.find(message => message.id === state.activeAssistantMessageId)
        : undefined;
      const existingPart = existingMessage?.parts.find(
        part => getToolCallIdFromPart(part) === approvalChunk.toolCallId
      );
      const existingToolName = getToolName(existingPart);
      const existingInput = getToolInput(existingPart) ?? {};

      const effects: StreamEffect[] = [
        {
          type: 'approval_request',
          payload: {
            approvalId: approvalChunk.approvalId,
            toolCallId: approvalChunk.toolCallId,
            toolCall: {
              toolName: existingToolName,
              toolCallId: approvalChunk.toolCallId,
              args: existingInput,
            },
          },
        },
      ];

      const existingUiState = ctx.toolUiStateMap[approvalChunk.toolCallId];
      if (
        !existingUiState ||
        typeof existingUiState.startedAt !== 'number' ||
        !Number.isFinite(existingUiState.startedAt)
      ) {
        effects.unshift({
          type: 'tool_ui_state',
          toolCallId: approvalChunk.toolCallId,
          patch: { startedAt: ctx.nowMs },
        });
      }

      return {
        state,
        messageOps: [],
        effects,
      };
    }

    const toolCallId = chunk.toolCallId;
    const previousUiState = toolCallId ? ctx.toolUiStateMap[toolCallId] : undefined;
    let nextInputText: string | undefined;
    if (chunk.type === 'tool-input-delta') {
      const delta = typeof chunk.inputTextDelta === 'string' ? chunk.inputTextDelta : '';
      const previousInputText =
        typeof previousUiState?.inputText === 'string' ? previousUiState.inputText : '';
      nextInputText = `${previousInputText}${delta}`;
    }

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...(message.parts as UiMessagePart[])];
      for (let i = 0; i < nextParts.length; i += 1) {
        const part = nextParts[i];
        if (!isTextPart(part) || part.state !== 'streaming') continue;
        nextParts[i] = {
          ...part,
          state: 'done',
        };
      }

      const existingPartIndex = nextParts.findIndex(
        part => getToolCallIdFromPart(part) === toolCallId
      );
      const existingPart = existingPartIndex >= 0 ? nextParts[existingPartIndex] : undefined;
      const existingToolPart = isDynamicToolPart(existingPart) ? existingPart : undefined;
      const chunkToolName =
        'toolName' in chunk && typeof chunk.toolName === 'string' && chunk.toolName.trim()
          ? chunk.toolName
          : undefined;

      const nextPart: DynamicToolPart = {
        ...(existingToolPart || {}),
        type: 'dynamic-tool',
        toolCallId,
        toolName:
          chunkToolName ||
          (existingToolPart ? existingToolPart.toolName : 'tool'),
      };

      const updatedPart = buildToolPartUpdate(nextPart, chunk, nextInputText);

      if (existingPartIndex >= 0) {
        nextParts[existingPartIndex] = updatedPart;
      } else {
        nextParts.push(updatedPart);
      }

      return {
        ...message,
        parts: nextParts as UIMessage['parts'],
      };
    });

    const effects: StreamEffect[] = [{ type: 'scroll' }];
    const uiPatch = buildToolUiStatePatch(chunk, ctx.nowMs, previousUiState, nextInputText);
    if (toolCallId && Object.keys(uiPatch).length > 0) {
      effects.unshift({
        type: 'tool_ui_state',
        toolCallId,
        patch: uiPatch,
      });
    }
    if (
      chunk.type === 'tool-input-available' ||
      chunk.type === 'tool-input-error' ||
      chunk.type === 'tool-output-available' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied'
    ) {
      const threadId = state.activeStreamThreadId || ctx.currentThreadId || '';
      if (threadId && updateResult.updatedMessage) {
        effects.unshift({
          type: 'persist',
          message: updateResult.updatedMessage,
          parentId: state.activeAssistantParentId || undefined,
          source: `tool-ui-chunk:${chunk.type}`,
          threadId,
        });
      }
    }

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects,
    };
  }

  if (action.type === 'memory_chunk') {
    const results = Array.isArray(action.chunk.results)
      ? action.chunk.results.filter(entry => isObjectRecord(entry) && typeof entry.summary === 'string')
      : [];

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...(message.parts as UiMessagePart[])];
      const existingIndex = nextParts.findIndex(part => isMemoryPart(part));

      const memoryPart: MemoryPart = {
        type: 'memory-retrieval',
        query: typeof action.chunk.query === 'string' ? action.chunk.query : '',
        results,
      };

      if (existingIndex >= 0) {
        nextParts[existingIndex] = memoryPart;
      } else {
        nextParts.unshift(memoryPart);
      }

      return {
        ...message,
        parts: nextParts as UIMessage['parts'],
      };
    });

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects: [{ type: 'scroll' }],
    };
  }

  return { state, messageOps: [], effects: [] };
};
