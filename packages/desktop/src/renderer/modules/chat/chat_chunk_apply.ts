/**
 * Apply one streamed chunk to the assistant message being built.
 *
 * The renderer-side counterpart of the backend's chunk-log reducer: same chunk
 * vocabulary, same rules, but applied incrementally as the UI receives them
 * instead of replayed from a log. Keeping one chunk protocol for both directions
 * is why this can be a pure function of `(message, chunk)`.
 */
import type { ChatUiChunk, ChatUiMessage, UiDynamicToolPart } from '@iki/backend/message/ui_protocol';

const findToolIndex = (parts: ChatUiMessage['parts'], toolCallId: string): number =>
  parts.findIndex(
    part => part.type === 'dynamic-tool' && (part as UiDynamicToolPart).toolCallId === toolCallId
  );

const ensureToolPart = (
  parts: ChatUiMessage['parts'],
  toolCallId: string,
  toolName: string
): UiDynamicToolPart => {
  const index = findToolIndex(parts, toolCallId);
  if (index >= 0) return parts[index] as UiDynamicToolPart;
  const created: UiDynamicToolPart = {
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state: 'input-streaming',
  };
  parts.push(created);
  return created;
};

/** Append `delta` to the last part of `type` that is still open, else open one. */
const appendDelta = (
  parts: ChatUiMessage['parts'],
  partType: 'text' | 'reasoning',
  delta: string
): ChatUiMessage['parts'] => {
  const last = parts[parts.length - 1];
  if (last && last.type === partType && (last as { state?: string }).state === 'streaming') {
    const target = last as { text: string };
    target.text += delta;
    return parts;
  }
  parts.push({ type: partType, text: delta, state: 'streaming' } as never);
  return parts;
};

const closePart = (parts: ChatUiMessage['parts'], partType: 'text' | 'reasoning'): void => {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part.type === partType && (part as { state?: string }).state === 'streaming') {
      (part as { state?: string }).state = 'done';
      return;
    }
  }
};

export const applyChatUiChunk = (
  message: ChatUiMessage,
  chunk: ChatUiChunk
): ChatUiMessage => {
  // Parts are mutated in place, so the message object identity is stable while
  // the content grows; the store is told to re-read via replaceMessage.
  const parts = message.parts as ChatUiMessage['parts'];

  switch (chunk.type) {
    case 'start':
      return message;
    case 'text-start':
      parts.push({ type: 'text', text: '', state: 'streaming' } as never);
      return message;
    case 'text-delta':
      appendDelta(parts, 'text', chunk.delta);
      return message;
    case 'text-end':
      closePart(parts, 'text');
      return message;
    case 'reasoning-start':
      parts.push({ type: 'reasoning', text: '', state: 'streaming' } as never);
      return message;
    case 'reasoning-delta':
      appendDelta(parts, 'reasoning', chunk.delta);
      return message;
    case 'reasoning-end':
      closePart(parts, 'reasoning');
      return message;
    case 'tool-input-start': {
      const tool = ensureToolPart(parts, chunk.toolCallId, chunk.toolName);
      tool.state = 'input-streaming';
      if (chunk.title) tool.title = chunk.title;
      return message;
    }
    case 'tool-input-delta': {
      const index = findToolIndex(parts, chunk.toolCallId);
      if (index < 0) return message;
      const tool = parts[index] as UiDynamicToolPart;
      const accumulated = typeof tool.input === 'string' ? tool.input : '';
      tool.input = accumulated + chunk.inputTextDelta;
      return message;
    }
    case 'tool-input-available': {
      const index = findToolIndex(parts, chunk.toolCallId);
      if (index < 0) return message;
      const tool = parts[index] as UiDynamicToolPart;
      tool.state = 'input-available';
      tool.input = chunk.input;
      return message;
    }
    case 'tool-input-error': {
      const index = findToolIndex(parts, chunk.toolCallId);
      if (index < 0) return message;
      const tool = parts[index] as UiDynamicToolPart;
      tool.state = 'output-error';
      tool.errorText = chunk.errorText;
      return message;
    }
    case 'tool-output-available':
    case 'tool-output-error':
    case 'tool-output-denied': {
      const index = findToolIndex(parts, chunk.toolCallId);
      if (index < 0) return message;
      const tool = parts[index] as UiDynamicToolPart;
      if (chunk.type === 'tool-output-available') {
        tool.state = 'output-available';
        tool.output = chunk.output;
      } else if (chunk.type === 'tool-output-denied') {
        tool.state = 'output-denied';
        if (chunk.reason) tool.approval = { approved: false, reason: chunk.reason };
      } else {
        tool.state = 'output-error';
        if (chunk.errorText) tool.errorText = chunk.errorText;
      }
      return message;
    }
    case 'tool-approval-request': {
      const tool = ensureToolPart(parts, chunk.toolCallId, chunk.toolName ?? 'tool');
      tool.state = 'approval-requested';
      tool.approval = { id: chunk.approvalId };
      if (chunk.input !== undefined) tool.input = chunk.input;
      return message;
    }
    default: {
      // `data-*` parts carry the kind in their own type name.
      if (typeof chunk.type === 'string' && chunk.type.startsWith('data-')) {
        parts.push({ type: chunk.type, data: (chunk as { data?: unknown }).data } as never);
      }
      return message;
    }
  }
};
