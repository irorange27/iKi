
import type { ChatUiChunk, ChatUiMessage, ChatUiPart, UiDynamicToolPart } from './ui_protocol';

const toolParts = (parts: ChatUiPart[]): UiDynamicToolPart[] =>
  parts.filter((part): part is UiDynamicToolPart => part.type === 'dynamic-tool');

const findToolPart = (parts: ChatUiPart[], toolCallId: string): UiDynamicToolPart | undefined =>
  toolParts(parts).find(part => part.toolCallId === toolCallId);

const messageIdOf = (chunk: ChatUiChunk, fallback: string): string => {
  const candidate = (chunk as { messageId?: unknown }).messageId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : fallback;
};

const openPart = (
  parts: ChatUiPart[],
  kind: 'text' | 'reasoning'
): { text: string; state?: string } | undefined => {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part.type === kind) {
      return part as unknown as { text: string; state?: string };
    }
  }
  return undefined;
};

const closePart = (parts: ChatUiPart[], kind: 'text' | 'reasoning'): void => {
  const part = openPart(parts, kind);
  if (part) part.state = 'done';
};

export type ReduceOptions = {

  messageId?: string;

  seed?: { messageId: string; parts: ChatUiPart[] };
};

const applyChunk = (
  byMessageId: Map<string, ChatUiMessage>,
  chunk: ChatUiChunk,
  fallbackId: string
): void => {
  if (chunk.type === 'start' || chunk.type === 'finish' || chunk.type === 'abort') return;

  const messageId = messageIdOf(chunk, fallbackId);
  const existing = byMessageId.get(messageId);
  if (!existing) {
    byMessageId.set(messageId, { id: messageId, role: 'assistant', parts: [] });
  }
  const parts = (byMessageId.get(messageId) as ChatUiMessage).parts;

  switch (chunk.type) {
    case 'text-start': {
      parts.push({ type: 'text', text: '', state: 'streaming' });
      return;
    }
    case 'text-delta': {
      const part = openPart(parts, 'text');
      if (part && part.state === 'streaming') {
        part.text += chunk.delta;
        return;
      }
      parts.push({ type: 'text', text: chunk.delta, state: 'streaming' });
      return;
    }
    case 'text-end': {
      closePart(parts, 'text');
      return;
    }
    case 'reasoning-start': {
      parts.push({ type: 'reasoning', text: '', state: 'streaming' });
      return;
    }
    case 'reasoning-delta': {
      const part = openPart(parts, 'reasoning');
      if (part && part.state === 'streaming') {
        part.text += chunk.delta;
        return;
      }
      parts.push({ type: 'reasoning', text: chunk.delta, state: 'streaming' });
      return;
    }
    case 'reasoning-end': {
      closePart(parts, 'reasoning');
      return;
    }
    case 'tool-input-start': {
      const found = findToolPart(parts, chunk.toolCallId);
      if (found) {
        found.toolName = chunk.toolName;
        found.state = 'input-streaming';
        if (chunk.title) found.title = chunk.title;
        return;
      }
      parts.push({
        type: 'dynamic-tool',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-streaming',
        ...(chunk.title ? { title: chunk.title } : {}),
      });
      return;
    }
    case 'tool-input-delta': {
      const found = findToolPart(parts, chunk.toolCallId);
      if (!found) return;

      const accumulated = typeof found.input === 'string' ? found.input : '';
      found.input = accumulated + chunk.inputTextDelta;
      return;
    }
    case 'tool-input-available': {

      const found = findToolPart(parts, chunk.toolCallId);
      if (!found) {
        parts.push({
          type: 'dynamic-tool',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName ?? 'tool',
          state: 'input-available',
          ...(chunk.input !== undefined ? { input: chunk.input } : {}),
        });
        return;
      }
      found.state = 'input-available';
      if (chunk.input !== undefined) found.input = chunk.input;
      return;
    }
    case 'tool-input-error': {
      const found = findToolPart(parts, chunk.toolCallId);
      if (!found) {
        parts.push({
          type: 'dynamic-tool',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName ?? 'tool',
          state: 'output-error',
          errorText: chunk.errorText,
        });
        return;
      }
      found.state = 'output-error';
      found.errorText = chunk.errorText;
      return;
    }
    case 'tool-output-available': {
      const found = findToolPart(parts, chunk.toolCallId);
      if (!found) {

        parts.push({
          type: 'dynamic-tool',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName ?? 'tool',
          state: 'output-available',
        });
        return;
      }
      found.state = 'output-available';
      found.output = chunk.output;
      return;
    }
    case 'tool-output-error': {
      const found = findToolPart(parts, chunk.toolCallId);
      if (!found) {

        parts.push({
          type: 'dynamic-tool',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName ?? 'tool',
          state: 'output-error',
        });
        return;
      }
      found.state = 'output-error';
      if (chunk.errorText) found.errorText = chunk.errorText;
      return;
    }
    case 'tool-output-denied': {
      const found = findToolPart(parts, chunk.toolCallId);
      if (!found) {

        parts.push({
          type: 'dynamic-tool',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName ?? 'tool',
          state: 'output-denied',
        });
        return;
      }
      found.state = 'output-denied';
      if (chunk.reason) found.approval = { approved: false, reason: chunk.reason };
      return;
    }
    case 'tool-approval-request': {
      const found = findToolPart(parts, chunk.toolCallId);
      if (found) {
        found.state = 'approval-requested';
        found.approval = { id: chunk.approvalId };
        if (chunk.input !== undefined) found.input = chunk.input;
        return;
      }
      parts.push({
        type: 'dynamic-tool',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName ?? 'tool',
        state: 'approval-requested',
        approval: { id: chunk.approvalId },
        ...(chunk.input !== undefined ? { input: chunk.input } : {}),
      });
      return;
    }
    case 'error': {
      parts.push({ type: 'text', text: chunk.errorText, state: 'done' });
      return;
    }
    default: {
      if (typeof chunk.type === 'string' && chunk.type.startsWith('data-')) {
        parts.push({
          type: chunk.type,
          data: (chunk as { data?: unknown }).data,
        } as unknown as ChatUiPart);
      }
      return;
    }
  }
};

export const reduceChunkLogToMessages = (
  chunks: readonly ChatUiChunk[],
  options: ReduceOptions = {}
): ChatUiMessage[] => {
  const fallbackId = options.messageId ?? 'assistant_recovered';
  const byMessageId = new Map<string, ChatUiMessage>();

  if (options.seed) {
    byMessageId.set(options.seed.messageId, {
      id: options.seed.messageId,
      role: 'assistant',
      parts: structuredClone(options.seed.parts),
    });
  }

  for (const chunk of chunks) {
    applyChunk(byMessageId, chunk, fallbackId);
  }

  const messages = [...byMessageId.values()];
  for (const message of messages) {
    for (const part of message.parts) {

      if (part.type === 'text' || part.type === 'reasoning') {
        const stateful = part as { state?: string };
        if (stateful.state === 'streaming') stateful.state = 'done';
      }
    }
  }
  return messages;
};

export const reduceChunkLogToMessage = (
  chunks: readonly ChatUiChunk[],
  options: ReduceOptions = {}
): ChatUiMessage | null => {
  const messages = reduceChunkLogToMessages(chunks, options);
  return messages.length > 0 ? messages[messages.length - 1] : null;
};
