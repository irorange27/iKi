import type { UIMessage, UIMessageChunk } from 'ai';

import {
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  parseToolInputFromText,
} from './ui_message_tool_parts';
import { isObjectRecord } from '../../../shared/chat/tool_parts';

type MessagePartRecord = Record<string, any> & { type: string };

export type StreamState = {
  activeAssistantMessageId: string | null;
  activeAssistantParentId: string | null;
  activeStreamThreadId: string | null;
  streamingAssistantText: string;
  streamRenderTick: number;
  streamRenderTraceId: string;
  streamRenderChunkCount: number;
  streamRenderChars: number;
};

export const createInitialStreamState = (): StreamState => ({
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
  streamRenderTick: 0,
  streamRenderTraceId: '',
  streamRenderChunkCount: 0,
  streamRenderChars: 0,
});

export type StreamContext = {
  messages: UIMessage[];
  createMessageId: () => string;
  currentThreadId: string | null;
  nowMs: number;
};

export type MessageOp =
  | { type: 'append'; message: UIMessage }
  | { type: 'replace'; messageId: string; message: UIMessage }
  | { type: 'remove'; messageId: string };

export type StreamEffect =
  | { type: 'scroll' }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; message: string }
  | {
      type: 'persist';
      message: UIMessage;
      threadId: string;
      parentId?: string;
      source: string;
    }
  | { type: 'notify_persisted'; threadId: string; shouldNotify: boolean }
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
  | { type: 'begin_turn'; threadId: string; parentId: string; tracePrefix?: string }
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

const shouldLogStreamChunk = (count: number) => count <= 3 || count % 20 === 0;

const resetTransientState = (state: StreamState): StreamState => ({
  ...state,
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
  streamRenderTraceId: '',
  streamRenderChunkCount: 0,
  streamRenderChars: 0,
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

const buildStreamingTextParts = (parts: UIMessage['parts'], delta: string): UIMessage['parts'] => {
  const nextParts = [...parts];
  const lastPart = nextParts[nextParts.length - 1];
  const shouldAppendToLast =
    isObjectRecord(lastPart) && lastPart.type === 'text' && lastPart.state === 'streaming';

  if (shouldAppendToLast) {
    const textPartIndex = nextParts.length - 1;
    const textPart = nextParts[textPartIndex] as Record<string, unknown>;
    const previousText = typeof textPart.text === 'string' ? textPart.text : '';
    nextParts[textPartIndex] = {
      ...textPart,
      text: `${previousText}${delta}`,
      state: 'streaming',
    } as any;
  } else {
    nextParts.push({
      type: 'text',
      text: delta,
      state: 'streaming',
    } as any);
  }

  return nextParts;
};

const finalizeTextParts = (
  parts: UIMessage['parts'],
  fullText: string,
  streamedText: string
): { parts: UIMessage['parts']; hasStreamingTextPart: boolean; appendedText?: string } => {
  const nextParts = [...parts];
  const textPartIndices = nextParts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => isObjectRecord(part) && part.type === 'text')
    .map(({ index }) => index);

  const existingTextPart =
    textPartIndices.length > 0
      ? (nextParts[textPartIndices[textPartIndices.length - 1]] as Record<string, unknown>)
      : undefined;
  const existingStreamed =
    existingTextPart && typeof existingTextPart.text === 'string' ? existingTextPart.text : '';

  const finalText = fullText.length > 0 ? fullText : streamedText || existingStreamed;
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
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  if (!hasStreamingTextPart && finalText && !existingStreamed) {
    nextParts.push({
      type: 'text',
      text: finalText,
      state: 'done',
    } as any);
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  return { parts: nextParts, hasStreamingTextPart };
};

const hasRenderableContent = (parts: UIMessage['parts']): boolean =>
  parts.some(part => {
    if (isObjectRecord(part) && part.type === 'text') {
      return typeof part.text === 'string' && part.text.trim().length > 0;
    }
    return true;
  });

const buildToolPartUpdate = (
  part: MessagePartRecord,
  chunk: UIMessageChunk,
  nowMs: number
): MessagePartRecord => {
  const nextPart = { ...part };

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
    return nextPart;
  }

  if (chunk.type === 'tool-input-delta') {
    const delta = typeof chunk.inputTextDelta === 'string' ? chunk.inputTextDelta : '';
    const previousInputText = typeof nextPart.inputText === 'string' ? nextPart.inputText : '';
    const inputText = `${previousInputText}${delta}`;
    nextPart.inputText = inputText;
    nextPart.input = parseToolInputFromText(inputText);
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
    delete nextPart.inputText;
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
    nextPart.endedAt = nowMs;
    nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
    delete nextPart.inputText;
    return nextPart;
  }

  if (chunk.type === 'tool-output-available') {
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
    return nextPart;
  }

  if (chunk.type === 'tool-output-error') {
    nextPart.output = {
      error: chunk.errorText || 'Tool execution failed',
    };
    nextPart.state = 'output-error';
    nextPart.endedAt = nowMs;
    nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
    delete nextPart.inputText;
    return nextPart;
  }

  if (chunk.type === 'tool-output-denied') {
    nextPart.state = 'output-denied';
    nextPart.output = {
      message: 'Tool execution denied',
      toolCallId: nextPart.toolCallId,
    };
    nextPart.endedAt = nowMs;
    nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
    delete nextPart.inputText;
    return nextPart;
  }

  return nextPart;
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
      streamRenderTraceId: `${action.tracePrefix || 'view'}-${ctx.nowMs}`,
      streamRenderChunkCount: 0,
      streamRenderChars: 0,
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
      streamRenderTraceId: state.streamRenderTraceId || `view-${ctx.nowMs}`,
      streamRenderChunkCount: state.streamRenderChunkCount + 1,
      streamRenderChars: state.streamRenderChars + action.delta.length,
    };

    const updateResult = updateAssistantMessage(nextState, ctx, message => {
      const nextParts = buildStreamingTextParts(message.parts, action.delta);
      return {
        ...message,
        parts: nextParts,
      };
    });

    const effects: StreamEffect[] = [{ type: 'scroll' }];
    if (shouldLogStreamChunk(nextState.streamRenderChunkCount)) {
      effects.unshift({
        type: 'log',
        level: 'log',
        message: `[StreamDebug][Renderer][ChatView][${nextState.streamRenderTraceId}] handleStreamChunk#${nextState.streamRenderChunkCount} len=${action.delta.length} totalChars=${nextState.streamRenderChars}`,
      });
    }

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
      const finalizeResult = finalizeTextParts(message.parts, action.fullText, streamedText);

      const updatedMessage: UIMessage = {
        ...message,
        parts: finalizeResult.parts,
      };

      if (!hasRenderableContent(updatedMessage.parts)) {
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
        type: 'log',
        level: 'log',
        message: `[StreamDebug][Renderer][ChatView][${
          state.streamRenderTraceId || 'unknown'
        }] handleResponseReceived fullTextLen=${(action.fullText || '').length} chunkCount=${
          state.streamRenderChunkCount
        } chunkChars=${state.streamRenderChars}`,
      },
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

      return {
        state,
        messageOps: [],
        effects: [
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
        ],
      };
    }

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...message.parts];
      for (let i = 0; i < nextParts.length; i += 1) {
        const part = nextParts[i];
        if (!isObjectRecord(part) || part.type !== 'text' || part.state !== 'streaming') continue;
        nextParts[i] = {
          ...part,
          state: 'done',
        } as any;
      }

      const toolCallId = chunk.toolCallId;
      const existingPartIndex = nextParts.findIndex(
        part => getToolCallIdFromPart(part) === toolCallId
      );
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

      const updatedPart = buildToolPartUpdate(nextPart, chunk, ctx.nowMs);

      if (existingPartIndex >= 0) {
        nextParts[existingPartIndex] = updatedPart as any;
      } else {
        nextParts.push(updatedPart as any);
      }

      return {
        ...message,
        parts: nextParts,
      };
    });

    const effects: StreamEffect[] = [{ type: 'scroll' }];
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
      const nextParts = [...message.parts] as Array<Record<string, any>>;
      const existingIndex = nextParts.findIndex(part => {
        if (!isObjectRecord(part)) return false;
        const partType = typeof part.type === 'string' ? part.type : '';
        return partType === 'memory-retrieval';
      });

      const memoryPart: MessagePartRecord = {
        type: 'memory-retrieval',
        query: typeof action.chunk.query === 'string' ? action.chunk.query : '',
        results,
      };

      if (existingIndex >= 0) {
        nextParts[existingIndex] = memoryPart as any;
      } else {
        nextParts.unshift(memoryPart as any);
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
